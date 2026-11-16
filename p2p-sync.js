// p2p-sync.js - Đồng bộ P2P (STUN/TURN xuyên tường lửa, Log chi tiết, PIN 60s & Tự nối lại khi đã cấp quyền)

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
        this.connections = []; // Danh sách kết nối Guest đang hoạt động & đã xác thực
        this.hostConn = null;
        this.isAuthenticated = false;

        // Danh sách thiết bị đã được Host cấp quyền (lưu bền vững để rớt mạng tự nối lại không cần PIN)
        this.authorizedDevices = this._loadAuthorizedDevices();
        this.deviceId = this._getOrCreateDeviceId();
        this.sessionToken = '';

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.authTimeoutTimer = null;
        this.pinTickerTimer = null;
        this.reconnectAttempts = 0;
        this.html5QrCode = null;

        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onPinTick = options.onPinTick || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));

        window.addEventListener('online', () => {
            const canReconnect = this.role === 'host' || (this.role === 'guest' && Boolean(this.sessionToken));
            console.log('[P2P-NET] 🌐 Trình duyệt báo có Internet trở lại.', {
                role: this.role,
                roomCode: this.roomCode,
                canReconnect
            });
            if (!this.isManualDisconnect && this.roomCode && canReconnect) {
                this.onToast('Đã có Internet trở lại. Đang khôi phục đồng bộ...', 'info');
                this._scheduleReconnect(500);
            }
        });

        window.addEventListener('offline', () => {
            console.warn('[P2P-NET] ⚠️ Trình duyệt báo mất kết nối Internet!');
            const canReconnect = this.role === 'host' || (this.role === 'guest' && Boolean(this.sessionToken));
            if (canReconnect) {
                this.onToast('Mất kết nối Internet! Dữ liệu vẫn lưu cục bộ và sẽ tự nối lại khi có mạng.', 'warning');
                this._emitStatus('reconnecting');
            }
        });
    }

    // Cấu hình máy chủ STUN + TURN (UDP/TCP 443) để kết nối được cả khi khác mạng 4G/Wi-Fi hoặc tường lửa chặn UDP
    _getPeerOptions() {
        return {
            debug: 2,
            config: {
                iceTransportPolicy: 'all',
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun.relay.metered.ca:80' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            }
        };
    }

    async ensurePeerLibrary() {
        if (window.Peer) return;
        console.log('[P2P-SYS] Đang tải thư viện PeerJS...');
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
            script.onload = () => {
                console.log('[P2P-SYS] ✅ Đã tải xong PeerJS.');
                resolve();
            };
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
            secondsLeft,
            slot
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

    // =========================================================
    // 1. THIẾT BỊ CHÍNH (HOST)
    // =========================================================
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
        console.log(`[P2P-HOST] Khởi tạo Host | Mã phòng: ${this.roomCode} | PeerID: ${peerId} | Reconnect: ${isReconnect}`);
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this.peer = new window.Peer(peerId, this._getPeerOptions());

        this.peer.on('open', (id) => {
            this.reconnectAttempts = 0;
            this.isAuthenticated = true;
            this._clearReconnectTimer();
            this._startPinTicker();
            this._emitStatus('connected');

            const pinInfo = this.getCurrentPinInfo();
            console.log(`[P2P-HOST] ✅ Sẵn sàng nhận kết nối! PeerID=${id} | PIN hiện tại=${pinInfo.pin} (còn ${pinInfo.secondsLeft}s)`);

            if (!isReconnect) {
                this.onToast(`Đã mở cổng đồng bộ phòng ${this.roomCode}`, 'success');
            } else {
                this.onToast(`Đã khôi phục phòng đồng bộ ${this.roomCode}`, 'success');
            }
        });

        this.peer.on('connection', (conn) => {
            console.log(`[P2P-HOST] 📩 Có kết nối đến từ Peer: ${conn.peer}`);

            if (conn.peerConnection) {
                conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
                    console.log(`[P2P-HOST] 🌐 ICE với ${conn.peer}: ${conn.peerConnection?.iceConnectionState}`);
                });
            }

            conn.on('open', () => {
                console.log(`[P2P-HOST] 🔓 Kênh dữ liệu với ${conn.peer} đã mở, đang chờ gói AUTH_REQUEST...`);
            });

            conn.on('data', (data) => {
                console.log(`[P2P-HOST] 📦 Nhận gói tin từ ${conn.peer}:`, data);
                if (!data || typeof data !== 'object') return;

                // BƯỚC 1: Xử lý xác thực từ Guest
                if (data.type === 'AUTH_REQUEST') {
                    const providedPin = String(data.pin || '').trim();
                    const guestDeviceId = String(data.deviceId || conn.peer).trim();
                    const providedToken = String(data.sessionToken || '').trim();

                    const currentSlot = Math.floor(Date.now() / 60000);
                    const validPins = [
                        computeTimeSyncedPin(this.roomCode, currentSlot),
                        computeTimeSyncedPin(this.roomCode, currentSlot - 1),
                        computeTimeSyncedPin(this.roomCode, currentSlot + 1)
                    ];

                    const savedToken = this.authorizedDevices[guestDeviceId];
                    const isTrustedReconnect = Boolean(savedToken && providedToken && savedToken === providedToken);
                    const isPinMatched = Boolean(providedPin && validPins.includes(providedPin));

                    console.log('[P2P-HOST] 🔍 Kết quả đối chiếu xác thực:', {
                        guestPeer: conn.peer,
                        guestDeviceId,
                        providedPin: providedPin || '(trống)',
                        validPinsHost: validPins,
                        isPinMatched,
                        isTrustedReconnect
                    });

                    if (!isTrustedReconnect && !isPinMatched) {
                        console.warn(`[P2P-HOST] ❌ TỪ CHỐI kết nối từ ${conn.peer}: Sai mã PIN!`);
                        conn.send({
                            type: 'AUTH_REJECTED',
                            reason: `Sai mã PIN (${providedPin})! PIN hiện tại trên máy chính là ${validPins[0]}.`
                        });
                        setTimeout(() => {
                            try { conn.close(); } catch (_) {}
                        }, 300);
                        return;
                    }

                    // Cấp/gia hạn token cho thiết bị này để rớt mạng tự kết nối lại không cần nhập lại PIN
                    const issuedToken = savedToken || `TOK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
                    this.authorizedDevices[guestDeviceId] = issuedToken;
                    this._saveAuthorizedDevices();

                    this.connections = this.connections.filter(c => c.peer !== conn.peer);
                    this.connections.push(conn);
                    this._emitStatus('connected');

                    console.log(`[P2P-HOST] ✅ CHẤP NHẬN kết nối từ ${conn.peer} (Device: ${guestDeviceId}). Đang gửi AUTH_ACCEPTED & dữ liệu...`);
                    this.onToast(
                        isTrustedReconnect ? 'Thiết bị giám thị vừa tự động kết nối lại!' : 'Một thiết bị giám thị đã xác thực và kết nối!',
                        'info'
                    );

                    conn.send({
                        type: 'AUTH_ACCEPTED',
                        sessionToken: issuedToken
                    });

                    conn.send({
                        type: 'SYNC_STATE',
                        payload: this.getAppState(),
                        senderRole: 'host',
                        isInitialSync: true,
                        timestamp: Date.now()
                    });
                    return;
                }

                // BƯỚC 2: Chặn gói tin nếu chưa xác thực
                const isAuthorizedPeer = this.connections.some(c => c.peer === conn.peer);
                if (!isAuthorizedPeer) {
                    console.warn(`[P2P-HOST] ⛔ Chặn gói tin chưa xác thực từ ${conn.peer}`);
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
                console.log(`[P2P-HOST] 🔌 Thiết bị ${conn.peer} đã ngắt kết nối.`);
                const prevLen = this.connections.length;
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                if (this.connections.length !== prevLen) {
                    this._emitStatus('connected');
                }
            });

            conn.on('error', (err) => {
                console.error(`[P2P-HOST] ⚠️ Lỗi kênh kết nối với ${conn.peer}:`, err);
            });
        });

        this.peer.on('disconnected', () => {
            console.warn('[P2P-HOST] ⚠️ Mất kết nối tới máy chủ tín hiệu PeerJS.');
            if (!this.isManualDisconnect) {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(3000);
            }
        });

        this.peer.on('error', (err) => {
            console.error('[P2P-HOST] ❌ Lỗi PeerJS Host:', err.type, err);
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

    // =========================================================
    // 2. THIẾT BỊ PHỤ (GUEST)
    // =========================================================
    async joinRoom(rawCode, inputPin = '', isReconnect = false) {
        const cleanCode = (rawCode || this.roomCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập hoặc quét Mã phòng thi!', 'warning');
            return;
        }

        const savedSession = this._loadSession();
        const savedToken = (savedSession && savedSession.roomCode === cleanCode) ? (savedSession.sessionToken || '') : '';
        const cleanPin = String(inputPin || '').replace(/\s+/g, '').trim();

        // Nếu đang ở chế độ tự nối lại nhưng không có token đã cấp quyền -> dừng ngay, không lặp vô tận
        if (isReconnect && !savedToken) {
            console.warn('[P2P-GUEST] ⛔ Hủy tự nối lại vì thiết bị chưa từng được cấp quyền.');
            this._clearSession();
            this.role = null;
            this.roomCode = null;
            this._emitStatus('disconnected');
            return;
        }

        if (!isReconnect && !cleanPin && !savedToken) {
            this._emitStatus('disconnected', 'Vui lòng nhập mã PIN 4 số đang hiển thị trên Thiết Bị Chính.');
            return;
        }

        await this.ensurePeerLibrary();
        this._cleanupPeerOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        this.roomCode = cleanCode;
        this.role = 'guest';
        this.sessionToken = savedToken;
        if (savedToken) this._saveSession();

        const targetPeerId = `${this.prefix}${cleanCode}`;
        let currentStage = 'Khởi tạo kết nối máy chủ tín hiệu';
        console.log(`[P2P-GUEST] Bắt đầu kết nối phòng ${cleanCode} -> Target=${targetPeerId}`, {
            providedPin: cleanPin || '(dùng token tự nối lại)',
            hasSavedToken: Boolean(savedToken),
            deviceId: this.deviceId,
            isReconnect
        });

        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        // Timeout 15s (đủ thời gian đàm phán qua TURN TCP 443 nếu mạng khó)
        this._clearAuthTimeout();
        this.authTimeoutTimer = setTimeout(() => {
            if (!this.isAuthenticated && !this.isManualDisconnect) {
                console.error(`[P2P-GUEST] ⏱️ HẾT THỜI GIAN CHỜ (15s) tại bước: "${currentStage}"`);
                this._cleanupPeerOnly();

                if (isReconnect && this.sessionToken) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(4000);
                } else {
                    // Thiết bị chưa xác thực -> Dừng hẳn, không nhảy sang reconnecting
                    this._clearSession();
                    this.role = null;
                    this.roomCode = null;
                    const timeoutMsg = `Không thể kết nối tới Thiết Bị Chính sau 15 giây (${currentStage}). Hãy tải lại trang trên Thiết Bị Chính rồi thử lại.`;
                    this._emitStatus('disconnected', timeoutMsg);
                    this.onToast('Kết nối quá hạn 15 giây. Kiểm tra lại Thiết Bị Chính.', 'error');
                }
            }
        }, 15000);

        this.peer = new window.Peer(this._getPeerOptions());

        this.peer.on('open', (myId) => {
            currentStage = `Đàm phán kênh WebRTC tới ${targetPeerId}`;
            console.log(`[P2P-GUEST] 1/4 Đã đăng ký PeerJS thành công (GuestID=${myId}). ${currentStage}...`);

            const conn = this.peer.connect(targetPeerId, {
                reliable: true,
                serialization: 'json'
            });
            this.hostConn = conn;

            if (conn.peerConnection) {
                conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
                    const iceState = conn.peerConnection?.iceConnectionState;
                    console.log(`[P2P-GUEST] 🌐 Trạng thái WebRTC ICE: ${iceState}`);
                    if (iceState === 'failed') {
                        currentStage = 'Kết nối ngang hàng WebRTC ICE thất bại';
                    }
                });
            }

            const sendAuthPacket = () => {
                currentStage = 'Đã mở kênh, đang chờ Thiết Bị Chính đối chiếu mã PIN';
                const authPayload = {
                    type: 'AUTH_REQUEST',
                    pin: cleanPin,
                    deviceId: this.deviceId,
                    sessionToken: savedToken,
                    isReconnect
                };
                console.log('[P2P-GUEST] 2/4 Kênh dữ liệu đã mở! Đang gửi gói AUTH_REQUEST:', authPayload);
                conn.send(authPayload);
            };

            if (conn.open) {
                sendAuthPacket();
            } else {
                conn.on('open', sendAuthPacket);
            }

            conn.on('data', (data) => {
                console.log('[P2P-GUEST] 3/4 Nhận phản hồi từ Host:', data);
                if (!data || typeof data !== 'object') return;

                if (data.type === 'AUTH_REJECTED') {
                    this._clearAuthTimeout();
                    const errMsg = data.reason || 'Sai mã PIN 4 số!';
                    console.warn(`[P2P-GUEST] ❌ Host từ chối xác thực: ${errMsg}`);

                    this.isManualDisconnect = true;
                    this.isAuthenticated = false;
                    this.sessionToken = '';
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
                    this._clearAuthTimeout();
                    this.reconnectAttempts = 0;
                    this.isAuthenticated = true;
                    this.sessionToken = data.sessionToken || savedToken;
                    this._saveSession(); // Lưu token cấp quyền để lần sau rớt mạng tự nối lại không cần PIN

                    this._clearReconnectTimer();
                    this._startPinTicker();
                    this._emitStatus('connected');

                    console.log(`[P2P-GUEST] 4/4 ✅ XÁC THỰC THÀNH CÔNG phòng ${cleanCode}! Token đã lưu: ${this.sessionToken}`);
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
                console.warn('[P2P-GUEST] 🔌 Kênh kết nối với Host bị đóng.');
                const wasAuthed = this.isAuthenticated || Boolean(this.sessionToken);
                this.isAuthenticated = false;
                if (!this.isManualDisconnect && wasAuthed) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3000);
                }
            });

            conn.on('error', (err) => {
                console.error('[P2P-GUEST] ⚠️ Lỗi kênh kết nối:', err);
                const wasAuthed = this.isAuthenticated || Boolean(this.sessionToken);
                this.isAuthenticated = false;
                if (!this.isManualDisconnect && wasAuthed) {
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3500);
                }
            });
        });

        this.peer.on('disconnected', () => {
            console.warn('[P2P-GUEST] ⚠️ Mất kết nối máy chủ tín hiệu PeerJS.');
            const wasAuthed = this.isAuthenticated || Boolean(this.sessionToken);
            if (!this.isManualDisconnect && wasAuthed) {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(3000);
            }
        });

        this.peer.on('error', (err) => {
            console.error('[P2P-GUEST] ❌ Lỗi PeerJS Guest:', err.type, err);
            if (this.isManualDisconnect) return;

            if (err.type === 'peer-unavailable' && !isReconnect) {
                this._clearAuthTimeout();
                this._cleanupPeerOnly();
                this._clearSession();
                this.role = null;
                this.roomCode = null;
                const notFoundMsg = `Không tìm thấy phòng "${cleanCode}". Hãy kiểm tra Thiết Bị Chính đã bật chia sẻ chưa.`;
                this._emitStatus('disconnected', notFoundMsg);
                this.onToast(notFoundMsg, 'error');
                return;
            }

            if (this.sessionToken) {
                this._emitStatus('reconnecting');
                this._scheduleReconnect(3500);
            }
        });
    }

    cancelConnecting() {
        console.log('[P2P-SYS] Người dùng chủ động hủy quá trình kết nối.');
        this.disconnect(false);
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
        this.sessionToken = '';
        this.stopQrScanner();
        this._stopPinTicker();
        this._clearReconnectTimer();
        this._clearAuthTimeout();
        this._cleanupPeerOnly();
        this._clearSession();

        this.role = null;
        this.roomCode = null;
        this.reconnectAttempts = 0;
        this._emitStatus('disconnected');
        if (notify) this.onToast('Đã tắt đồng bộ trực tiếp.', 'info');
    }

    buildJoinUrl(roomCode) {
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

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
                    if (roomCode && typeof onRoomScanned === 'function') {
                        onRoomScanned(roomCode);
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

    async scanQrFromImageFile(file, onRoomScanned = null) {
        if (!file) return;
        try {
            await this.ensureQrScannerLibrary();
            await this.stopQrScanner();

            const scanner = new window.Html5Qrcode('p2p-qr-file-temp');
            const decodedText = await scanner.scanFile(file, true);
            scanner.clear();

            const roomCode = this.parseQrRoomCode(decodedText);
            if (roomCode && typeof onRoomScanned === 'function') {
                onRoomScanned(roomCode);
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
            } else if (saved.role === 'guest' && saved.sessionToken) {
                console.log(`[P2P-GUEST] 🔄 Khôi phục phiên đã cấp quyền cho phòng ${saved.roomCode}...`);
                this.joinRoom(saved.roomCode, '', true);
            }
        }
        return '';
    }

    _scheduleReconnect(delayMs = 3500) {
        if (this.isManualDisconnect || !this.roomCode || !this.role) return;
        if (this.role === 'guest' && !this.sessionToken) return;

        this._clearReconnectTimer();
        this.reconnectAttempts += 1;
        console.log(`[P2P-SYS] ⏳ Lên lịch tự nối lại lần #${this.reconnectAttempts} sau ${delayMs}ms...`);
        this.reconnectTimer = setTimeout(() => {
            if (this.isManualDisconnect) return;
            if (this.role === 'host') {
                this.startHost(this.roomCode, true);
            } else if (this.role === 'guest' && this.sessionToken) {
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

    _clearAuthTimeout() {
        if (this.authTimeoutTimer) {
            clearTimeout(this.authTimeoutTimer);
            this.authTimeoutTimer = null;
        }
    }

    // Gỡ toàn bộ listener trước khi destroy() để không kích hoạt nhầm sự kiện disconnected
    _cleanupPeerOnly() {
        if (this.hostConn) {
            try {
                this.hostConn.removeAllListeners?.();
                this.hostConn.close();
            } catch (_) {}
            this.hostConn = null;
        }
        this.connections.forEach(c => {
            try {
                c.removeAllListeners?.();
                c.close();
            } catch (_) {}
        });
        this.connections = [];

        if (this.peer) {
            try {
                this.peer.removeAllListeners?.();
                this.peer.destroy();
            } catch (_) {}
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

    _getOrCreateDeviceId() {
        try {
            let id = localStorage.getItem('SGS_DEVICE_ID');
            if (!id) {
                id = 'DEV-' + Math.random().toString(36).slice(2, 10).toUpperCase();
                localStorage.setItem('SGS_DEVICE_ID', id);
            }
            return id;
        } catch (_) {
            return 'DEV-' + Math.random().toString(36).slice(2, 10).toUpperCase();
        }
    }

    _saveAuthorizedDevices() {
        try {
            sessionStorage.setItem('SGS_HOST_AUTH_DEVICES', JSON.stringify(this.authorizedDevices));
        } catch (_) {}
    }

    _loadAuthorizedDevices() {
        try {
            const raw = sessionStorage.getItem('SGS_HOST_AUTH_DEVICES');
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    }

    _saveSession() {
        try {
            localStorage.setItem('SGS_P2P_SESSION', JSON.stringify({
                role: this.role,
                roomCode: this.roomCode,
                sessionToken: this.sessionToken,
                expiresAt: Date.now() + 4 * 60 * 60 * 1000
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
