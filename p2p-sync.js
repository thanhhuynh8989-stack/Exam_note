// p2p-sync.js - Đồng bộ P2P bảo mật bằng Mã PIN động 60s & QR chỉ chứa Mã Phòng

export function computeTimeSyncedPin(roomCode, timeSlot = Math.floor(Date.now() / 60000)) {
    const cleanRoom = String(roomCode || '').trim().toUpperCase();
    const seed = `${cleanRoom}::SGS_TIME_PIN_V1::${timeSlot}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const pinNum = Math.abs(hash >>> 0) % 10000;
    return String(pinNum).padStart(4, '0');
}

export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'SGS-EXAM-';
        this.peer = null;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.connections = [];
        this.hostConn = null;
        this.isAuthenticated = false;

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.pinTickerTimer = null;
        this.reconnectAttempts = 0;
        this.html5QrCode = null;

        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onPinTick = options.onPinTick || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));

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

    async ensureQrScannerLibrary() {
        if (window.Html5Qrcode) return;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Không thể tải thư viện quét QR'));
            document.head.appendChild(script);
        });
    }

    getCurrentPinInfo() {
        if (!this.roomCode) return { pin: '', secondsLeft: 60 };
        const nowSec = Math.floor(Date.now() / 1000);
        const slot = Math.floor(nowSec / 60);
        const secondsLeft = 60 - (nowSec % 60);
        return {
            pin: computeTimeSyncedPin(this.roomCode, slot),
            secondsLeft
        };
    }

    _startPinTicker() {
        this._stopPinTicker();
        const tick = () => {
            if (!this.roomCode || !this.role) return;
            const info = this.getCurrentPinInfo();
            this.onPinTick({
                pin: info.pin,
                secondsLeft: info.secondsLeft
            });
        };
        tick();
        this.pinTickerTimer = setInterval(tick, 1000);
    }

    _stopPinTicker() {
        if (this.pinTickerTimer) {
            clearInterval(this.pinTickerTimer);
            this.pinTickerTimer = null;
        }
    }

    // Khởi tạo phòng thi (Host)
    async startHost(customCode = null, isReconnect = false) {
        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || this.roomCode || `THI-${randomDigits}`;
        this.role = 'host';
        this._saveSession();

        const peerId = `${this.prefix}${this.roomCode}`;
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer(peerId, { debug: 1 });

        this.peer.on('open', () => {
            this.reconnectAttempts = 0;
            this.isAuthenticated = true;
            this._clearReconnectTimer();
            this._startPinTicker();
            this._emitStatus('connected');

            if (!isReconnect) {
                this.onToast(`Đã mở cổng đồng bộ phòng ${this.roomCode}`, 'success');
            } else {
                this.onToast(`Đã khôi phục phòng đồng bộ ${this.roomCode}`, 'success');
            }
        });

        this.peer.on('connection', (conn) => {
            conn.on('data', (data) => {
                if (!data || typeof data !== 'object') return;

                // BƯỚC 1: Xác thực mã PIN động theo thời gian (chấp nhận khung hiện tại & ±1 phút)
                if (data.type === 'AUTH_REQUEST') {
                    const providedPin = String(data.pin || '').trim();
                    const currentSlot = Math.floor(Date.now() / 60000);
                    const validPins = [
                        computeTimeSyncedPin(this.roomCode, currentSlot),
                        computeTimeSyncedPin(this.roomCode, currentSlot - 1),
                        computeTimeSyncedPin(this.roomCode, currentSlot + 1)
                    ];

                    if (!providedPin || !validPins.includes(providedPin)) {
                        conn.send({
                            type: 'AUTH_REJECTED',
                            reason: 'Mã PIN 4 số không đúng hoặc đã hết hạn! Vui lòng xem mã PIN hiện tại trên Thiết Bị Chính.'
                        });
                        setTimeout(() => {
                            try { conn.close(); } catch (_) {}
                        }, 250);
                        return;
                    }

                    // Xác thực thành công
                    this.connections = this.connections.filter(c => c.peer !== conn.peer);
                    this.connections.push(conn);
                    this._emitStatus('connected');
                    this.onToast('Một thiết bị giám thị đã xác thực và kết nối!', 'info');

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

                // BƯỚC 2: Chặn mọi gói tin nếu chưa xác thực
                const isAuthorizedPeer = this.connections.some(c => c.peer === conn.peer);
                if (!isAuthorizedPeer) {
                    try { conn.close(); } catch (_) {}
                    return;
                }

                // BƯỚC 3: Hợp nhất dữ liệu & phát tán
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
                this.startHost(null, false);
            } else {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(4000);
            }
        });
    }

    // Thiết bị phụ (Guest) tham gia phòng bằng Mã phòng + Mã PIN
    async joinRoom(rawCode, inputPin = '', isReconnect = false) {
        const cleanCode = (rawCode || this.roomCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập hoặc quét Mã phòng thi!', 'warning');
            return;
        }

        const pinToSend = isReconnect
            ? computeTimeSyncedPin(cleanCode)
            : String(inputPin || '').trim();

        if (!pinToSend) {
            this._emitStatus('disconnected', 'Vui lòng nhập mã PIN 4 số đang hiển thị trên Thiết Bị Chính.');
            return;
        }

        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

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
                conn.send({
                    type: 'AUTH_REQUEST',
                    pin: pinToSend
                });
            });

            conn.on('data', (data) => {
                if (!data || typeof data !== 'object') return;

                if (data.type === 'AUTH_REJECTED') {
                    const errMsg = data.reason || 'Sai mã PIN 4 số!';
                    this.isManualDisconnect = true;
                    this.isAuthenticated = false;
                    this._stopPinTicker();
                    this._clearReconnectTimer();
                    this._clearSession();
                    this._cleanupPeerOnly();

                    this.role = null;
                    this.roomCode = null;
                    this._emitStatus('disconnected', errMsg);
                    this.onToast(errMsg, 'error');
                    return;
                }

                if (data.type === 'AUTH_ACCEPTED') {
                    this.reconnectAttempts = 0;
                    this.isAuthenticated = true;
                    this._clearReconnectTimer();
                    this._startPinTicker();
                    this._emitStatus('connected');
                    this.onToast(
                        isReconnect ? `Đã tự động kết nối lại phòng ${cleanCode}` : `Đã xác thực & đồng bộ phòng ${cleanCode}`,
                        'success'
                    );

                    conn.send({
                        type: 'SYNC_STATE',
                        payload: this.getAppState(),
                        senderRole: 'guest',
                        isInitialSync: true,
                        timestamp: Date.now()
                    });
                    return;
                }

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

    disconnect(notify = true) {
        this.isManualDisconnect = true;
        this.isAuthenticated = false;
        this.stopQrScanner();
        this._stopPinTicker();
        this._clearReconnectTimer();
        this._cleanupPeerOnly();
        this._clearSession();

        this.role = null;
        this.roomCode = null;
        this.reconnectAttempts = 0;
        this._emitStatus('disconnected');
        if (notify) this.onToast('Đã tắt đồng bộ trực tiếp.', 'info');
    }

    // Mã QR chỉ chứa thông tin Phòng thi (không chứa PIN)
    buildJoinUrl(roomCode) {
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    // Chỉ trích xuất Mã Phòng thi từ chuỗi QR
    parseQrRoomCode(rawText) {
        const text = (rawText || '').trim();
        try {
            const parsedUrl = new URL(text);
            const room = parsedUrl.searchParams.get('room');
            if (room) return room.trim().toUpperCase();
        } catch (_) {
            const firstPart = text.split('|')[0].trim().toUpperCase();
            if (firstPart) return firstPart;
        }
        return '';
    }

    // Chế độ 1: Quét QR trực tiếp bằng Camera (chỉ điền Mã phòng, chưa kết nối ngay)
    async startQrScanner(elementId = 'p2p-qr-reader', onRoomScanned = null) {
        if (!window.isSecureContext) {
            return { ok: false, reason: 'INSECURE_CONTEXT' };
        }

        try {
            await this.ensureQrScannerLibrary();
        } catch (_) {
            return { ok: false, reason: 'LIB_LOAD_FAILED' };
        }

        await this.stopQrScanner();

        try {
            this.html5QrCode = new window.Html5Qrcode(elementId);
            await this.html5QrCode.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 220, height: 220 } },
                async (decodedText) => {
                    await this.stopQrScanner();
                    const roomCode = this.parseQrRoomCode(decodedText);
                    if (roomCode) {
                        if (typeof onRoomScanned === 'function') onRoomScanned(roomCode);
                    } else {
                        this.onToast('Mã QR không chứa thông tin Phòng thi hợp lệ!', 'error');
                    }
                },
                () => {}
            );
            return { ok: true };
        } catch (err) {
            this.html5QrCode = null;
            return { ok: false, reason: err?.name || 'CAMERA_DENIED' };
        }
    }

    // Chế độ 2: Chụp ảnh bằng Camera điện thoại (chỉ điền Mã phòng, chưa kết nối ngay)
    async scanQrFromImageFile(file, onRoomScanned = null) {
        if (!file) return;
        try {
            await this.ensureQrScannerLibrary();
            await this.stopQrScanner();

            const scanner = new window.Html5Qrcode('p2p-qr-file-temp');
            const decodedText = await scanner.scanFile(file, true);
            scanner.clear();

            const roomCode = this.parseQrRoomCode(decodedText);
            if (roomCode) {
                if (typeof onRoomScanned === 'function') onRoomScanned(roomCode);
            } else {
                this.onToast('Không tìm thấy Mã Phòng thi hợp lệ trong ảnh!', 'error');
            }
        } catch (_) {
            this.onToast('Không đọc được mã QR từ ảnh. Hãy chụp rõ nét và chính diện mã QR.', 'error');
        }
    }

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

    // Trả về mã phòng từ URL (?room=...) để giao diện tự điền và hiện ô nhập PIN
    checkAutoJoinFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');

        if (roomParam) {
            window.history.replaceState({}, document.title, window.location.pathname);
            return roomParam.trim().toUpperCase();
        }

        const saved = this._loadSession();
        if (saved && saved.roomCode && saved.role) {
            if (saved.role === 'host') {
                this.startHost(saved.roomCode, true);
            } else if (saved.role === 'guest') {
                this.joinRoom(saved.roomCode, '', true);
            }
        }
        return '';
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
                this.joinRoom(this.roomCode, '', true);
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
        const pinInfo = this.getCurrentPinInfo();
        this.onStatusChange({
            status,
            role: this.role,
            roomCode: this.roomCode,
            dynamicPin: pinInfo.pin,
            pinSecondsLeft: pinInfo.secondsLeft,
            authError,
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
