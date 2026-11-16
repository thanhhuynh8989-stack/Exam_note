// p2p-sync.js - Đồng bộ đa thiết bị xuyên mạng (WSS Relay cổng 443, PIN động 60s & Token tự nối lại)

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

const WSS_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
];

export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'SGS-EXAM-';
        this.client = null;
        this.brokerIndex = 0;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.activeGuests = new Map(); // deviceId -> lastSeen timestamp
        this.isAuthenticated = false;

        // Danh sách thiết bị đã được Host cấp quyền (lưu bền vững để rớt mạng tự nối lại không cần PIN)
        this.authorizedDevices = this._loadAuthorizedDevices();
        this.deviceId = this._getOrCreateDeviceId();
        this.sessionToken = '';

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.authTimeoutTimer = null;
        this.pinTickerTimer = null;
        this.heartbeatTimer = null;
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
                this._scheduleReconnect(400);
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

        // Khi mở lại màn hình điện thoại sau khi tắt/chuyển app -> kiểm tra & nối lại ngay
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isManualDisconnect && this.roomCode && this.role) {
                if (!this.client || !this.client.connected) {
                    console.log('[P2P-NET] 📱 Màn hình hoạt động trở lại, đang kiểm tra kết nối...');
                    this._scheduleReconnect(200);
                }
            }
        });
    }

    async ensureRelayLibrary() {
        if (window.mqtt) return;
        const urls = [
            'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js',
            'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js'
        ];
        for (const src of urls) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                if (window.mqtt) {
                    console.log('[P2P-SYS] ✅ Đã tải xong thư viện truyền tải WSS.');
                    return;
                }
            } catch (_) {
                console.warn(`[P2P-SYS] Thử nguồn dự phòng tiếp theo sau khi lỗi tải: ${src}`);
            }
        }
        throw new Error('Không thể tải thư viện kết nối mạng. Hãy kiểm tra Internet.');
    }

    async ensureQrScannerLibrary() {
        if (window.Html5Qrcode) return;
        const urls = [
            'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
            'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js'
        ];
        for (const src of urls) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
                if (window.Html5Qrcode) return;
            } catch (_) {}
        }
        throw new Error('Không thể tải thư viện quét QR');
    }

    _topics(roomCode) {
        const base = `sgs-exam-relay/v1/${this.prefix}${roomCode}`;
        return {
            inbox: `${base}/inbox`,                 // Guest -> Host
            broadcast: `${base}/broadcast`,         // Host -> Tất cả Guest
            client: (devId) => `${base}/client/${devId}` // Host -> Riêng 1 Guest (xác thực & sync ban đầu)
        };
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

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.client || !this.client.connected || !this.roomCode) return;
            const topics = this._topics(this.roomCode);

            if (this.role === 'host') {
                // Dọn dẹp thiết bị phụ không còn phản hồi quá 45 giây
                const now = Date.now();
                let changed = false;
                for (const [devId, lastSeen] of this.activeGuests.entries()) {
                    if (now - lastSeen > 45000) {
                        this.activeGuests.delete(devId);
                        changed = true;
                    }
                }
                if (changed) this._emitStatus('connected');
            } else if (this.role === 'guest' && this.isAuthenticated && this.sessionToken) {
                // Guest gửi nhịp tim nhẹ để Host biết thiết bị vẫn đang trực tuyến
                this.client.publish(topics.inbox, JSON.stringify({
                    type: 'HEARTBEAT',
                    deviceId: this.deviceId,
                    sessionToken: this.sessionToken,
                    ts: Date.now()
                }));
            }
        }, 12000);
    }

    _stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    // =========================================================
    // 1. THIẾT BỊ CHÍNH (HOST)
    // =========================================================
    async startHost(customCode = null, isReconnect = false) {
        try {
            await this.ensureRelayLibrary();
        } catch (err) {
            this.onToast(err.message, 'error');
            return;
        }

        this._cleanupClientOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || this.roomCode || `THI-${randomDigits}`;
        this.role = 'host';
        this._saveSession();

        const brokerUrl = WSS_BROKERS[this.brokerIndex % WSS_BROKERS.length];
        const topics = this._topics(this.roomCode);
        const clientId = `SGS_HOST_${this.roomCode}_${this.deviceId}_${Math.random().toString(36).slice(2, 6)}`;

        console.log(`[P2P-HOST] Khởi tạo Host qua WSS | Phòng: ${this.roomCode} | Broker: ${brokerUrl} | Reconnect: ${isReconnect}`);
        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        let connectTimeout = setTimeout(() => {
            if (!this.isAuthenticated && !this.isManualDisconnect) {
                console.warn(`[P2P-HOST] ⏱️ Broker ${brokerUrl} phản hồi chậm, chuyển sang Broker dự phòng...`);
                this.brokerIndex += 1;
                this.startHost(this.roomCode, isReconnect);
            }
        }, 5000);

        this.client = window.mqtt.connect(brokerUrl, {
            clientId,
            clean: true,
            connectTimeout: 5000,
            reconnectPeriod: 2500,
            keepalive: 15
        });

        this.client.on('connect', () => {
            clearTimeout(connectTimeout);
            this.client.subscribe(topics.inbox, { qos: 1 }, (err) => {
                if (err) {
                    console.error('[P2P-HOST] ❌ Lỗi đăng ký kênh inbox:', err);
                    return;
                }
                this.reconnectAttempts = 0;
                this.isAuthenticated = true;
                this._clearReconnectTimer();
                this._startPinTicker();
                this._startHeartbeat();
                this._emitStatus('connected');

                const pinInfo = this.getCurrentPinInfo();
                console.log(`[P2P-HOST] ✅ Sẵn sàng nhận kết nối đa mạng! Phòng=${this.roomCode} | PIN hiện tại=${pinInfo.pin} (còn ${pinInfo.secondsLeft}s)`);

                if (!isReconnect) {
                    this.onToast(`Đã mở cổng đồng bộ phòng ${this.roomCode}`, 'success');
                } else {
                    this.onToast(`Đã khôi phục phòng đồng bộ ${this.roomCode}`, 'success');
                }
            });
        });

        this.client.on('message', (topic, rawPayload) => {
            if (topic !== topics.inbox) return;
            let data = null;
            try {
                data = JSON.parse(rawPayload.toString());
            } catch (_) {
                return;
            }
            if (!data || typeof data !== 'object') return;

            const guestDeviceId = String(data.deviceId || '').trim();
            if (!guestDeviceId) return;

            // BƯỚC 1: Xử lý yêu cầu xác thực từ Guest
            if (data.type === 'AUTH_REQUEST') {
                console.log('[P2P-HOST] 📩 Nhận yêu cầu AUTH_REQUEST:', data);
                const providedPin = String(data.pin || '').trim();
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
                    guestDeviceId,
                    providedPin: providedPin || '(trống)',
                    validPinsHost: validPins,
                    isPinMatched,
                    isTrustedReconnect
                });

                if (!isTrustedReconnect && !isPinMatched) {
                    console.warn(`[P2P-HOST] ❌ TỪ CHỐI thiết bị ${guestDeviceId}: Sai mã PIN!`);
                    this.client.publish(topics.client(guestDeviceId), JSON.stringify({
                        type: 'AUTH_REJECTED',
                        reason: `Sai mã PIN (${providedPin})! PIN hiện tại trên Thiết Bị Chính là ${validPins[0]}.`
                    }), { qos: 1 });
                    return;
                }

                // Cấp/gia hạn token cho thiết bị này để rớt mạng tự nối lại không cần nhập lại PIN
                const issuedToken = savedToken || `TOK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
                this.authorizedDevices[guestDeviceId] = issuedToken;
                this._saveAuthorizedDevices();

                this.activeGuests.set(guestDeviceId, Date.now());
                this._emitStatus('connected');

                console.log(`[P2P-HOST] ✅ CHẤP NHẬN thiết bị ${guestDeviceId}. Gửi AUTH_ACCEPTED & dữ liệu phòng thi...`);
                this.onToast(
                    isTrustedReconnect ? 'Thiết bị giám thị vừa tự động kết nối lại!' : 'Một thiết bị giám thị đã xác thực và kết nối!',
                    'info'
                );

                this.client.publish(topics.client(guestDeviceId), JSON.stringify({
                    type: 'AUTH_ACCEPTED',
                    sessionToken: issuedToken
                }), { qos: 1 });

                // Gửi ngay trạng thái hiện tại của phòng thi cho thiết bị mới vào
                this.client.publish(topics.client(guestDeviceId), JSON.stringify({
                    type: 'SYNC_STATE',
                    payload: this.getAppState(),
                    senderRole: 'host',
                    isInitialSync: true,
                    timestamp: Date.now()
                }), { qos: 1 });
                return;
            }

            // BƯỚC 2: Kiểm tra quyền cho mọi gói tin khác
            const savedToken = this.authorizedDevices[guestDeviceId];
            if (!savedToken || data.sessionToken !== savedToken) {
                console.warn(`[P2P-HOST] ⛔ Chặn gói tin chưa xác thực từ ${guestDeviceId}`);
                return;
            }

            this.activeGuests.set(guestDeviceId, Date.now());

            if (data.type === 'HEARTBEAT') {
                this._emitStatus('connected');
                return;
            }

            if (data.type === 'GUEST_LEAVE') {
                this.activeGuests.delete(guestDeviceId);
                this._emitStatus('connected');
                return;
            }

            // BƯỚC 3: Nhận thay đổi từ Guest -> Hợp nhất & phát tán cho toàn bộ phòng
            if (data.type === 'SYNC_STATE') {
                this.onStateReceived(data.payload, {
                    senderRole: data.senderRole || 'guest',
                    isInitialSync: !!data.isInitialSync
                });
                this.broadcast(this.getAppState(), guestDeviceId, false);
            }
        });

        this.client.on('offline', () => {
            console.warn('[P2P-HOST] ⚠️ Mất kết nối tới máy chủ chuyển tiếp WSS.');
            if (!this.isManualDisconnect) {
                this._emitStatus('reconnecting');
            }
        });

        this.client.on('reconnect', () => {
            console.log('[P2P-HOST] 🔄 Đang tự động kết nối lại WSS...');
            if (!this.isManualDisconnect) {
                this._emitStatus('reconnecting');
            }
        });

        this.client.on('error', (err) => {
            console.error('[P2P-HOST] ❌ Lỗi WSS Host:', err);
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

        try {
            await this.ensureRelayLibrary();
        } catch (err) {
            this.onToast(err.message, 'error');
            return;
        }

        this._cleanupClientOnly();
        this.isManualDisconnect = false;
        this.isAuthenticated = false;

        this.roomCode = cleanCode;
        this.role = 'guest';
        this.sessionToken = savedToken;
        if (savedToken) this._saveSession();

        const brokerUrl = WSS_BROKERS[this.brokerIndex % WSS_BROKERS.length];
        const topics = this._topics(cleanCode);
        const myClientTopic = topics.client(this.deviceId);
        const clientId = `SGS_GUEST_${cleanCode}_${this.deviceId}_${Math.random().toString(36).slice(2, 6)}`;

        let currentStage = 'Kết nối máy chủ chuyển tiếp WSS (cổng 443)';
        console.log(`[P2P-GUEST] Bắt đầu kết nối phòng ${cleanCode} | Broker: ${brokerUrl}`, {
            providedPin: cleanPin || '(dùng token tự nối lại)',
            hasSavedToken: Boolean(savedToken),
            deviceId: this.deviceId,
            isReconnect
        });

        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this._clearAuthTimeout();
        this.authTimeoutTimer = setTimeout(() => {
            if (!this.isAuthenticated && !this.isManualDisconnect) {
                console.error(`[P2P-GUEST] ⏱️ HẾT THỜI GIAN CHỜ (10s) tại bước: "${currentStage}"`);
                this._cleanupClientOnly();

                if (isReconnect && this.sessionToken) {
                    this.brokerIndex += 1;
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3000);
                } else {
                    this._clearSession();
                    this.role = null;
                    this.roomCode = null;
                    const timeoutMsg = `Không nhận được phản hồi từ phòng "${cleanCode}" sau 10 giây (${currentStage}). Hãy kiểm tra Thiết Bị Chính đang mở chia sẻ và có mạng.`;
                    this._emitStatus('disconnected', timeoutMsg);
                    this.onToast('Không tìm thấy phản hồi từ Thiết Bị Chính.', 'error');
                }
            }
        }, 10000);

        this.client = window.mqtt.connect(brokerUrl, {
            clientId,
            clean: true,
            connectTimeout: 5000,
            reconnectPeriod: 2500,
            keepalive: 15
        });

        this.client.on('connect', () => {
            currentStage = `Đăng ký kênh nhận phản hồi từ phòng ${cleanCode}`;
            console.log(`[P2P-GUEST] 1/4 Đã kết nối WSS (${brokerUrl}). ${currentStage}...`);

            this.client.subscribe([myClientTopic, topics.broadcast], { qos: 1 }, (err) => {
                if (err) {
                    console.error('[P2P-GUEST] ❌ Lỗi subscribe kênh:', err);
                    return;
                }

                currentStage = `Đã gửi mã PIN, đang chờ Thiết Bị Chính (${cleanCode}) đối chiếu`;
                const authPayload = {
                    type: 'AUTH_REQUEST',
                    pin: cleanPin,
                    deviceId: this.deviceId,
                    sessionToken: savedToken,
                    isReconnect
                };
                console.log('[P2P-GUEST] 2/4 Đã gửi gói AUTH_REQUEST tới Host:', authPayload);
                this.client.publish(topics.inbox, JSON.stringify(authPayload), { qos: 1 });
            });
        });

        this.client.on('message', (topic, rawPayload) => {
            let data = null;
            try {
                data = JSON.parse(rawPayload.toString());
            } catch (_) {
                return;
            }
            if (!data || typeof data !== 'object') return;

            // Phản hồi riêng từ Host gửi về cho thiết bị này
            if (topic === myClientTopic) {
                console.log('[P2P-GUEST] 3/4 Nhận phản hồi trực tiếp từ Host:', data);

                if (data.type === 'AUTH_REJECTED') {
                    this._clearAuthTimeout();
                    const errMsg = data.reason || 'Sai mã PIN 4 số!';
                    console.warn(`[P2P-GUEST] ❌ Host từ chối xác thực: ${errMsg}`);

                    this.isManualDisconnect = true;
                    this.isAuthenticated = false;
                    this.sessionToken = '';
                    this._stopPinTicker();
                    this._stopHeartbeat();
                    this._clearReconnectTimer();
                    this._clearSession();
                    this._cleanupClientOnly();

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
                    this._saveSession();

                    this._clearReconnectTimer();
                    this._startPinTicker();
                    this._startHeartbeat();
                    this._emitStatus('connected');

                    console.log(`[P2P-GUEST] 4/4 ✅ XÁC THỰC THÀNH CÔNG phòng ${cleanCode}! Token=${this.sessionToken}`);
                    this.onToast(
                        isReconnect ? `Đã tự động kết nối lại phòng ${cleanCode}` : `Đã xác thực & đồng bộ phòng ${cleanCode}`,
                        'success'
                    );

                    // Gửi dữ liệu cục bộ lên Host để hợp nhất (nếu có chấm điểm lúc rớt mạng)
                    this.client.publish(topics.inbox, JSON.stringify({
                        type: 'SYNC_STATE',
                        deviceId: this.deviceId,
                        sessionToken: this.sessionToken,
                        payload: this.getAppState(),
                        senderRole: 'guest',
                        isInitialSync: true,
                        timestamp: Date.now()
                    }), { qos: 1 });
                    return;
                }

                if (data.type === 'SYNC_STATE' && this.isAuthenticated) {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync
                    });
                }
                return;
            }

            // Kênh đồng bộ chung của toàn phòng
            if (topic === topics.broadcast && this.isAuthenticated) {
                if (data.excludeDeviceId && data.excludeDeviceId === this.deviceId) {
                    return; // Bỏ qua gói phản hồi của chính thiết bị này
                }
                if (data.type === 'SYNC_STATE') {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync
                    });
                }
            }
        });

        this.client.on('offline', () => {
            console.warn('[P2P-GUEST] ⚠️ Mất kết nối tới máy chủ chuyển tiếp WSS.');
            if (!this.isManualDisconnect && this.sessionToken) {
                this.isAuthenticated = false;
                this._emitStatus('reconnecting');
            }
        });

        this.client.on('reconnect', () => {
            console.log('[P2P-GUEST] 🔄 Đang tự động kết nối lại WSS...');
            if (!this.isManualDisconnect && this.sessionToken) {
                this._emitStatus('reconnecting');
            }
        });

        this.client.on('error', (err) => {
            console.error('[P2P-GUEST] ❌ Lỗi WSS Guest:', err);
        });
    }

    cancelConnecting() {
        console.log('[P2P-SYS] Người dùng chủ động hủy quá trình kết nối.');
        this.disconnect(false);
    }

    broadcast(statePayload, excludeDeviceId = null, isInitialSync = false) {
        if (!this.role || !this.isAuthenticated || !this.client || !this.client.connected || !this.roomCode) return;

        const topics = this._topics(this.roomCode);

        if (this.role === 'host') {
            this.client.publish(topics.broadcast, JSON.stringify({
                type: 'SYNC_STATE',
                payload: statePayload,
                senderRole: 'host',
                excludeDeviceId,
                isInitialSync,
                timestamp: Date.now()
            }), { qos: 1 });
        } else if (this.role === 'guest' && this.sessionToken) {
            this.client.publish(topics.inbox, JSON.stringify({
                type: 'SYNC_STATE',
                deviceId: this.deviceId,
                sessionToken: this.sessionToken,
                payload: statePayload,
                senderRole: 'guest',
                isInitialSync,
                timestamp: Date.now()
            }), { qos: 1 });
        }
    }

    disconnect(notify = true) {
        // Báo cho Host biết thiết bị phụ rời phòng trước khi ngắt
        if (this.role === 'guest' && this.client && this.client.connected && this.roomCode && this.sessionToken) {
            try {
                const topics = this._topics(this.roomCode);
                this.client.publish(topics.inbox, JSON.stringify({
                    type: 'GUEST_LEAVE',
                    deviceId: this.deviceId,
                    sessionToken: this.sessionToken
                }));
            } catch (_) {}
        }

        this.isManualDisconnect = true;
        this.isAuthenticated = false;
        this.sessionToken = '';
        this.activeGuests.clear();
        this.stopQrScanner();
        this._stopPinTicker();
        this._stopHeartbeat();
        this._clearReconnectTimer();
        this._clearAuthTimeout();
        this._cleanupClientOnly();
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

    _scheduleReconnect(delayMs = 2500) {
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

    _cleanupClientOnly() {
        if (this.client) {
            try {
                this.client.removeAllListeners?.();
                this.client.end(true);
            } catch (_) {}
            this.client = null;
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
            peerCount: this.activeGuests.size,
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
            localStorage.setItem('SGS_HOST_AUTH_DEVICES', JSON.stringify(this.authorizedDevices));
        } catch (_) {}
    }

    _loadAuthorizedDevices() {
        try {
            const raw = localStorage.getItem('SGS_HOST_AUTH_DEVICES');
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
