// p2p-sync.js - Quản lý đồng bộ P2P (Smart Merge, Auto-Reconnect, Mật khẩu/PIN & Quét Camera QR)

export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'SGS-EXAM-';
        this.peer = null;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.password = ''; // Mật khẩu / Mã PIN ghép đôi của phòng thi
        this.connections = []; // Chỉ chứa các kết nối Guest đã xác thực thành công
        this.hostConn = null;
        this.isAuthenticated = false;

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.html5QrCode = null;

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

    // Khởi tạo hoặc khôi phục phòng thi (Host) kèm mật khẩu/PIN bảo vệ
    async startHost(customCode = null, password = '', isReconnect = false) {
        // Hỗ trợ tương thích ngược nếu tham số thứ 2 là boolean (isReconnect)
        if (typeof password === 'boolean') {
            isReconnect = password;
            password = this.password || '';
        }

        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || this.roomCode || `THI-${randomDigits}`;
        this.password = (password !== undefined && password !== null) ? String(password).trim() : (this.password || '');
        this.role = 'host';
        this._saveSession();

        const peerId = `${this.prefix}${this.roomCode}`;
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer(peerId, { debug: 1 });

        this.peer.on('open', () => {
            this.reconnectAttempts = 0;
            this.isAuthenticated = true;
            this._clearReconnectTimer();
            this._emitStatus('connected');

            if (!isReconnect) {
                const lockMsg = this.password ? ` (Mã ghép đôi: ${this.password})` : '';
                this.onToast(`Đã mở cổng đồng bộ: ${this.roomCode}${lockMsg}`, 'success');
            } else {
                this.onToast(`Đã khôi phục phòng đồng bộ ${this.roomCode}`, 'success');
            }
        });

        this.peer.on('connection', (conn) => {
            conn.on('data', (data) => {
                if (!data || typeof data !== 'object') return;

                // BƯỚC 1: Kiểm tra gói tin xác thực mật khẩu từ thiết bị phụ
                if (data.type === 'AUTH_REQUEST') {
                    const requiredPwd = (this.password || '').trim();
                    const providedPwd = (data.password || '').trim();

                    if (requiredPwd && providedPwd !== requiredPwd) {
                        conn.send({
                            type: 'AUTH_REJECTED',
                            reason: 'Sai mật khẩu hoặc mã ghép đôi phòng thi!'
                        });
                        setTimeout(() => {
                            try { conn.close(); } catch (_) {}
                        }, 250);
                        return;
                    }

                    // Xác thực hợp lệ -> Đưa vào danh sách kết nối được phép truy cập
                    this.connections = this.connections.filter(c => c.peer !== conn.peer);
                    this.connections.push(conn);
                    this._emitStatus('connected');
                    this.onToast('Một thiết bị giám thị đã xác thực và kết nối!', 'info');

                    // Báo xác thực thành công & gửi trạng thái hiện tại của Host để Guest Smart Merge
                    conn.send({ type: 'AUTH_ACCEPTED' });
                    conn.send({
                        type: 'SYNC_STATE',
                        payload: this.getAppState(),
                        senderRole: 'host',
                        isInitialSync: true,
                        timestamp: Date.now()
                    });
                    return;
                }

                // BƯỚC 2: Chặn mọi gói dữ liệu nếu thiết bị chưa xác thực
                const isAuthorizedPeer = this.connections.some(c => c.peer === conn.peer);
                if (!isAuthorizedPeer) {
                    try { conn.close(); } catch (_) {}
                    return;
                }

                // BƯỚC 3: Nhận dữ liệu từ Guest hợp lệ -> Hợp nhất thông minh & phát tán lại
                if (data.type === 'SYNC_STATE') {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'guest',
                        isInitialSync: !!data.isInitialSync
                    });

                    this.broadcast(this.getAppState(), null, false);
                }
            });

            conn.on('close', () => {
                const prevLen = this.connections.length;
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                if (this.connections.length !== prevLen) {
                    this._emitStatus('connected');
                }
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
                this.startHost(null, this.password, false);
            } else {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(4000);
            }
        });
    }

    // Tham gia hoặc tự kết nối lại phòng thi (Guest) kèm mật khẩu/PIN
    async joinRoom(rawCode, password = '', isReconnect = false) {
        // Hỗ trợ tương thích ngược nếu tham số thứ 2 là boolean (isReconnect)
        if (typeof password === 'boolean') {
            isReconnect = password;
            password = this.password || '';
        }

        const cleanCode = (rawCode || this.roomCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập mã phòng thi hoặc quét mã QR!', 'warning');
            return;
        }

        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        this.roomCode = cleanCode;
        this.password = (password !== undefined && password !== null) ? String(password).trim() : (this.password || '');
        this.role = 'guest';
        this._saveSession();

        const targetPeerId = `${this.prefix}${cleanCode}`;
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer({ debug: 1 });

        this.peer.on('open', () => {
            const conn = this.peer.connect(targetPeerId, { reliable: true });
            this.hostConn = conn;

            conn.on('open', () => {
                // Gửi yêu cầu xác thực mật khẩu ngay khi kênh mở (chưa truyền dữ liệu)
                conn.send({
                    type: 'AUTH_REQUEST',
                    password: this.password
                });
            });

            conn.on('data', (data) => {
                if (!data || typeof data !== 'object') return;

                // Bị Host từ chối do sai mật khẩu / PIN
                if (data.type === 'AUTH_REJECTED') {
                    const errMsg = data.reason || 'Sai mật khẩu hoặc mã ghép đôi!';
                    this.isManualDisconnect = true;
                    this.isAuthenticated = false;
                    this._clearReconnectTimer();
                    this._clearSession();
                    this._cleanupPeerOnly();

                    this.role = null;
                    this.roomCode = null;
                    this._emitStatus('disconnected', errMsg);
                    this.onToast(errMsg, 'error');
                    return;
                }

                // Được Host xác thực thành công
                if (data.type === 'AUTH_ACCEPTED') {
                    this.reconnectAttempts = 0;
                    this.isAuthenticated = true;
                    this._clearReconnectTimer();
                    this._emitStatus('connected');
                    this.onToast(
                        isReconnect ? `Đã tự động kết nối lại phòng ${cleanCode}` : `Đã xác thực & đồng bộ với phòng ${cleanCode}`,
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
                    return;
                }

                // Chỉ nhận dữ liệu đồng bộ sau khi đã xác thực
                if (data.type === 'SYNC_STATE' && this.isAuthenticated) {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync
                    });
                }
            });

            conn.on('close', () => {
                this.isAuthenticated = false;
                if (!this.isManualDisconnect) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3500);
                }
            });

            conn.on('error', () => {
                this.isAuthenticated = false;
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

        this.peer.on('error', () => {
            if (this.isManualDisconnect) return;
            this._emitStatus('reconnecting');
            this._scheduleReconnect(4000);
        });
    }

    // Phát tán dữ liệu (chỉ gửi khi đã xác thực thành công)
    broadcast(statePayload, excludePeerId = null, isInitialSync = false) {
        if (!this.role || !this.isAuthenticated) return;

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
        this.isAuthenticated = false;
        this.stopQrScanner();
        this._clearReconnectTimer();
        this._cleanupPeerOnly();
        this._clearSession();

        this.role = null;
        this.roomCode = null;
        this.password = '';
        this.reconnectAttempts = 0;
        this._emitStatus('disconnected');
        if (notify) this.onToast('Đã tắt đồng bộ trực tiếp.', 'info');
    }

    // Tạo URL tham gia phòng (đính kèm mã phòng & mật khẩu để quét QR vào thẳng)
    buildJoinUrl(roomCode, password = this.password) {
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('room', roomCode);
        if (password && String(password).trim()) {
            url.searchParams.set('pwd', String(password).trim());
        }
        return url.toString();
    }

    // Phân tích chuỗi dữ liệu đọc được từ Camera QR
    parseQrPayload(rawText) {
        const text = (rawText || '').trim();
        try {
            const parsedUrl = new URL(text);
            const room = parsedUrl.searchParams.get('room');
            const pwd = parsedUrl.searchParams.get('pwd') || '';
            if (room) {
                return { roomCode: room.trim().toUpperCase(), password: pwd.trim() };
            }
        } catch (_) {
            // Hỗ trợ định dạng chuỗi thuần: "THI-4829" hoặc "THI-4829|1234"
            const parts = text.split('|');
            if (parts[0]) {
                return {
                    roomCode: parts[0].trim().toUpperCase(),
                    password: (parts[1] || '').trim()
                };
            }
        }
        return null;
    }

    // Mở Camera thiết bị phụ để quét mã QR phòng thi
    async startQrScanner(elementId = 'p2p-qr-reader', onScanned = null) {
        if (!window.Html5Qrcode) {
            this.onToast('Trình duyệt chưa tải xong bộ quét mã QR. Vui lòng thử lại.', 'warning');
            return false;
        }

        await this.stopQrScanner();

        try {
            this.html5QrCode = new window.Html5Qrcode(elementId);
            await this.html5QrCode.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 220, height: 220 } },
                async (decodedText) => {
                    await this.stopQrScanner();
                    const parsed = this.parseQrPayload(decodedText);
                    if (parsed && parsed.roomCode) {
                        if (typeof onScanned === 'function') {
                            onScanned(parsed);
                        }
                        this.joinRoom(parsed.roomCode, parsed.password, false);
                    } else {
                        this.onToast('Mã QR không hợp lệ cho phòng thi!', 'error');
                    }
                },
                () => {} // Bỏ qua khung hình chưa nhận diện được mã
            );
            return true;
        } catch (err) {
            this.html5QrCode = null;
            this.onToast('Không thể mở Camera. Hãy cấp quyền Camera cho trình duyệt.', 'error');
            return false;
        }
    }

    // Tắt Camera quét mã QR
    async stopQrScanner() {
        if (this.html5QrCode) {
            try {
                if (this.html5QrCode.isScanning) {
                    await this.html5QrCode.stop();
                }
                this.html5QrCode.clear();
            } catch (_) {}
            this.html5QrCode = null;
        }
    }

    // Kiểm tra tự động kết nối qua URL (?room=...&pwd=...) hoặc khôi phục phiên trước khi tải lại trang
    checkAutoJoinFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        const pwdParam = params.get('pwd') || '';

        if (roomParam) {
            this.joinRoom(roomParam, pwdParam, false);
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }

        const saved = this._loadSession();
        if (saved && saved.roomCode && saved.role) {
            if (saved.role === 'host') {
                this.startHost(saved.roomCode, saved.password || '', true);
            } else if (saved.role === 'guest') {
                this.joinRoom(saved.roomCode, saved.password || '', true);
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
                this.startHost(this.roomCode, this.password, true);
            } else if (this.role === 'guest') {
                this.joinRoom(this.roomCode, this.password, true);
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

    _emitStatus(status, authError = '') {
        this.onStatusChange({
            status,
            role: this.role,
            roomCode: this.roomCode,
            password: this.password,
            authError,
            peerCount: this.connections.length,
            reconnectAttempts: this.reconnectAttempts,
            joinUrl: (this.role === 'host' && this.roomCode) ? this.buildJoinUrl(this.roomCode, this.password) : null
        });
    }

    _saveSession() {
        try {
            localStorage.setItem('SGS_P2P_SESSION', JSON.stringify({
                role: this.role,
                roomCode: this.roomCode,
                password: this.password,
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
