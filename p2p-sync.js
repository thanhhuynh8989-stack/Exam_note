export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'SGS-EXAM-';
        this.peer = null;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.connections = [];
        this.hostConn = null;

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;

        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));

        // Tự động kích hoạt khôi phục kết nối ngay khi trình duyệt có Internet trở lại
        window.addEventListener('online', () => {
            if (!this.isManualDisconnect && this.roomCode && this.role) {
                this.onToast('Đã có Internet trở lại. Đang khôi phục đồng bộ...', 'info');
                this._scheduleReconnect(500);
            }
        });

        window.addEventListener('offline', () => {
            if (this.role) {
                this.onToast('Mất kết nối Internet! Dữ liệu vẫn được lưu cục bộ và sẽ tự đồng bộ khi có mạng.', 'warning');
                this._emitStatus('reconnecting');
            }
        });
    }

    async ensurePeerLibrary() {
        if (window.Peer) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Không thể tải thư viện PeerJS'));
            document.head.appendChild(script);
        });
    }

    // Khởi tạo hoặc khôi phục phòng thi (Host)
    async startHost(customCode = null, isReconnect = false) {
        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || this.roomCode || `THI-${randomDigits}`;
        this.role = 'host';
        this._saveSession();

        const peerId = `${this.prefix}${this.roomCode}`;
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer(peerId, { debug: 1 });

        this.peer.on('open', () => {
            this.reconnectAttempts = 0;
            this._clearReconnectTimer();
            this._emitStatus('connected');
            if (!isReconnect) {
                this.onToast(`Đã mở cổng đồng bộ: ${this.roomCode}`, 'success');
            } else {
                this.onToast(`Đã khôi phục phòng đồng bộ ${this.roomCode}`, 'success');
            }
        });

        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                // Tránh trùng kết nối từ cùng 1 peer
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                this.connections.push(conn);
                this._emitStatus('connected');
                this.onToast('Một thiết bị giám thị vừa kết nối!', 'info');

                // Gửi trạng thái hiện tại của Host kèm cờ isInitialSync để Guest thực hiện Smart Merge
                conn.send({
                    type: 'SYNC_STATE',
                    payload: this.getAppState(),
                    senderRole: 'host',
                    isInitialSync: true,
                    timestamp: Date.now()
                });
            });

            conn.on('data', (data) => {
                if (data && data.type === 'SYNC_STATE') {
                    // Host nhận dữ liệu từ Guest -> Hợp nhất thông minh (Smart Merge) vào Host
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'guest',
                        isInitialSync: !!data.isInitialSync
                    });

                    // Phát tán bản đã hợp nhất hoàn chỉnh cho toàn bộ các máy (bao gồm cả máy vừa gửi)
                    this.broadcast(this.getAppState(), null, false);
                }
            });

            conn.on('close', () => {
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                this._emitStatus('connected');
            });
        });

        this.peer.on('disconnected', () => {
            if (!this.isManualDisconnect) {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(3000);
            }
        });

        this.peer.on('error', (err) => {
            if (this.isManualDisconnect) return;

            if (err.type === 'unavailable-id' && !isReconnect) {
                this.roomCode = null;
                this.startHost();
            } else {
                // Lỗi mạng / server signaling tạm thời -> thử đăng ký lại đúng mã phòng cũ
                this._emitStatus('reconnecting');
                this._scheduleReconnect(4000);
            }
        });
    }

    // Tham gia hoặc tự kết nối lại phòng thi (Guest)
    async joinRoom(rawCode, isReconnect = false) {
        const cleanCode = (rawCode || this.roomCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập mã phòng thi!', 'warning');
            return;
        }

        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;

        this.roomCode = cleanCode;
        this.role = 'guest';
        this._saveSession();

        const targetPeerId = `${this.prefix}${cleanCode}`;
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer({ debug: 1 });

        this.peer.on('open', () => {
            const conn = this.peer.connect(targetPeerId, { reliable: true });
            this.hostConn = conn;

            conn.on('open', () => {
                this.reconnectAttempts = 0;
                this._clearReconnectTimer();
                this._emitStatus('connected');
                this.onToast(
                    isReconnect ? `Đã tự động kết nối lại phòng ${cleanCode}` : `Đã đồng bộ trực tiếp với phòng ${cleanCode}`,
                    'success'
                );

                // Gửi dữ liệu cục bộ hiện tại lên Host để Host hợp nhất điểm chấm lúc rớt mạng (nếu có)
                conn.send({
                    type: 'SYNC_STATE',
                    payload: this.getAppState(),
                    senderRole: 'guest',
                    isInitialSync: true,
                    timestamp: Date.now()
                });
            });

            conn.on('data', (data) => {
                if (data && data.type === 'SYNC_STATE') {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync
                    });
                }
            });

            conn.on('close', () => {
                if (!this.isManualDisconnect) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3500);
                }
            });

            conn.on('error', () => {
                if (!this.isManualDisconnect) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(4000);
                }
            });
        });

        this.peer.on('disconnected', () => {
            if (!this.isManualDisconnect) {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(3500);
            }
        });

        this.peer.on('error', (err) => {
            if (this.isManualDisconnect) return;
            // Nếu chưa tìm thấy Host (do Host cũng đang rớt mạng), tiếp tục thử lại định kỳ
            this._emitStatus('reconnecting');
            this._scheduleReconnect(4000);
        });
    }

    // Phát tán dữ liệu
    broadcast(statePayload, excludePeerId = null, isInitialSync = false) {
        if (!this.role) return;

        const message = {
            type: 'SYNC_STATE',
            payload: statePayload,
            senderRole: this.role,
            isInitialSync,
            timestamp: Date.now()
        };

        if (this.role === 'host') {
            this.connections.forEach(conn => {
                if (conn.open && conn.peer !== excludePeerId) {
                    conn.send(message);
                }
            });
        } else if (this.role === 'guest' && this.hostConn && this.hostConn.open) {
            this.hostConn.send(message);
        }
    }

    // Chủ động ngắt kết nối (dừng Auto-Reconnect)
    disconnect(notify = true) {
        this.isManualDisconnect = true;
        this._clearReconnectTimer();
        this._cleanupPeerOnly();
        this._clearSession();

        this.role = null;
        this.roomCode = null;
        this.reconnectAttempts = 0;
        this._emitStatus('disconnected');
        if (notify) this.onToast('Đã tắt đồng bộ trực tiếp.', 'info');
    }

    buildJoinUrl(roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    // Kiểm tra tự động kết nối qua URL (?room=...) hoặc khôi phục phiên trước khi tải lại trang
    checkAutoJoinFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            this.joinRoom(roomParam, false);
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }

        const saved = this._loadSession();
        if (saved && saved.roomCode && saved.role) {
            if (saved.role === 'host') {
                this.startHost(saved.roomCode, true);
            } else if (saved.role === 'guest') {
                this.joinRoom(saved.roomCode, true);
            }
        }
    }

    _scheduleReconnect(delayMs = 3500) {
        if (this.isManualDisconnect || !this.roomCode || !this.role) return;
        this._clearReconnectTimer();

        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
            if (this.isManualDisconnect) return;
            if (this.role === 'host') {
                this.startHost(this.roomCode, true);
            } else if (this.role === 'guest') {
                this.joinRoom(this.roomCode, true);
            }
        }, delayMs);
    }

    _clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    _cleanupPeerOnly() {
        if (this.hostConn) {
            try { this.hostConn.close(); } catch (_) {}
            this.hostConn = null;
        }
        this.connections.forEach(c => {
            try { c.close(); } catch (_) {}
        });
        this.connections = [];

        if (this.peer) {
            try { this.peer.destroy(); } catch (_) {}
            this.peer = null;
        }
    }

    _emitStatus(status) {
        this.onStatusChange({
            status,
            role: this.role,
            roomCode: this.roomCode,
            peerCount: this.connections.length,
            reconnectAttempts: this.reconnectAttempts,
            joinUrl: (this.role === 'host' && this.roomCode) ? this.buildJoinUrl(this.roomCode) : null
        });
    }

    _saveSession() {
        try {
            localStorage.setItem('SGS_P2P_SESSION', JSON.stringify({
                role: this.role,
                roomCode: this.roomCode,
                expiresAt: Date.now() + 3 * 60 * 60 * 1000
            }));
        } catch (_) {}
    }

    _loadSession() {
        try {
            const raw = localStorage.getItem('SGS_P2P_SESSION');
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (Date.now() > data.expiresAt) {
                this._clearSession();
                return null;
            }
            return data;
        } catch (_) {
            return null;
        }
    }

    _clearSession() {
        try {
            localStorage.removeItem('SGS_P2P_SESSION');
        } catch (_) {}
    }
}
