// p2p-sync.js - Đồng bộ đa thiết bị xuyên mạng (Host phê duyệt trực tiếp & Quản lý danh sách Guest)

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
        this.isAuthenticated = false;

        // Quản lý danh sách yêu cầu chờ duyệt & thiết bị đã cấp quyền trên Host
        this.pendingRequests = new Map(); // deviceId -> { deviceId, deviceName, requestedAt }
        this.authorizedDevices = this._loadAuthorizedDevices(); // { [deviceId]: { token, deviceName, approvedAt } }
        this.activeGuests = new Map(); // deviceId -> lastSeen timestamp

        this.deviceId = this._getOrCreateDeviceId();
        this.defaultDeviceName = this._detectDeviceName();
        this.sessionToken = '';

        this.isManualDisconnect = false;
        this.reconnectTimer = null;
        this.authTimeoutTimer = null;
        this.heartbeatTimer = null;
        this.reconnectAttempts = 0;
        this.html5QrCode = null;

        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));

        window.addEventListener('online', () => {
            const canReconnect = this.role === 'host' || (this.role === 'guest' && Boolean(this.sessionToken));
            if (!this.isManualDisconnect && this.roomCode && canReconnect) {
                this.onToast('Đã có Internet trở lại. Đang khôi phục đồng bộ...', 'info');
                this._scheduleReconnect(400);
            }
        });

        window.addEventListener('offline', () => {
            const canReconnect = this.role === 'host' || (this.role === 'guest' && Boolean(this.sessionToken));
            if (canReconnect) {
                this.onToast('Mất kết nối Internet! Dữ liệu vẫn lưu cục bộ và sẽ tự nối lại khi có mạng.', 'warning');
                this._emitStatus('reconnecting');
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isManualDisconnect && this.roomCode && this.role) {
                if (!this.client || !this.client.connected) {
                    this._scheduleReconnect(200);
                }
            }
        });
    }

    _detectDeviceName() {
        const ua = navigator.userAgent || '';
        let os = 'Thiết bị';
        if (/iPhone/i.test(ua)) os = 'iPhone';
        else if (/iPad/i.test(ua)) os = 'iPad';
        else if (/Android/i.test(ua)) os = 'Điện thoại Android';
        else if (/Windows/i.test(ua)) os = 'Máy tính Windows';
        else if (/Mac OS X/i.test(ua)) os = 'MacBook / Mac';

        let browser = '';
        if (/Edg\//i.test(ua)) browser = 'Edge';
        else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
        else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
        else if (/Firefox\//i.test(ua)) browser = 'Firefox';

        return browser ? `${os} (${browser})` : os;
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
                if (window.mqtt) return;
            } catch (_) {}
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
        const base = `sgs-exam-relay/v2/${this.prefix}${roomCode}`;
        return {
            inbox: `${base}/inbox`,
            broadcast: `${base}/broadcast`,
            client: (devId) => `${base}/client/${devId}`
        };
    }

    _startHeartbeat() {
        this._stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.client || !this.client.connected || !this.roomCode) return;
            const topics = this._topics(this.roomCode);

            if (this.role === 'host') {
                const now = Date.now();
                let changed = false;
                for (const [devId, lastSeen] of this.activeGuests.entries()) {
                    if (now - lastSeen > 40000) {
                        this.activeGuests.delete(devId);
                        changed = true;
                    }
                }
                if (changed) this._emitStatus('connected');
            } else if (this.role === 'guest' && this.isAuthenticated && this.sessionToken) {
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

        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        const connectTimeout = setTimeout(() => {
            if (!this.isAuthenticated && !this.isManualDisconnect) {
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
                if (err) return;
                this.reconnectAttempts = 0;
                this.isAuthenticated = true;
                this._clearReconnectTimer();
                this._startHeartbeat();
                this._emitStatus('connected');

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

            // BƯỚC 1: Nhận yêu cầu tham gia phòng từ Guest
            if (data.type === 'JOIN_REQUEST') {
                const guestName = String(data.deviceName || 'Thiết bị giám thị').trim();
                const providedToken = String(data.sessionToken || '').trim();
                const savedEntry = this.authorizedDevices[guestDeviceId];

                // Nếu thiết bị đã từng được Host duyệt trước đó -> tự động cho vào lại ngay
                if (savedEntry && providedToken && savedEntry.token === providedToken) {
                    savedEntry.deviceName = guestName || savedEntry.deviceName;
                    this._saveAuthorizedDevices();

                    this.pendingRequests.delete(guestDeviceId);
                    this.activeGuests.set(guestDeviceId, Date.now());
                    this._emitStatus('connected');
                    this.onToast(`"${savedEntry.deviceName}" vừa tự động kết nối lại!`, 'info');

                    this._sendApprovalAndState(guestDeviceId, savedEntry.token);
                    return;
                }

                // Thiết bị mới -> Đưa vào hàng chờ để Host bấm Đồng ý hoặc Từ chối
                this.pendingRequests.set(guestDeviceId, {
                    deviceId: guestDeviceId,
                    deviceName: guestName,
                    requestedAt: Date.now()
                });
                this.onToast(`"${guestName}" đang xin tham gia phòng thi!`, 'info');
                this._emitStatus('connected', '', true);
                return;
            }

            // Guest chủ động hủy yêu cầu khi đang chờ duyệt
            if (data.type === 'CANCEL_REQUEST') {
                if (this.pendingRequests.delete(guestDeviceId)) {
                    this._emitStatus('connected');
                }
                return;
            }

            // BƯỚC 2: Kiểm tra quyền cho mọi gói tin dữ liệu
            const savedEntry = this.authorizedDevices[guestDeviceId];
            if (!savedEntry || data.sessionToken !== savedEntry.token) {
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

            // BƯỚC 3: Hợp nhất dữ liệu từ Guest hợp lệ & phát tán lại
            if (data.type === 'SYNC_STATE') {
                const isInitial = !!data.isInitialSync;
                this.onStateReceived(data.payload, {
                    senderRole: data.senderRole || 'guest',
                    isInitialSync: isInitial,
                    isReconnect: !!data.isReconnect
                });

                const mergedSnapshot = this.getAppState();
                // Phát tán cho tất cả thiết bị khác
                this.broadcast(mergedSnapshot, guestDeviceId, false);

                // Nếu là đồng bộ ban đầu/khôi phục mạng, gửi lại bản đã hợp nhất cho chính Guest này
                if (isInitial) {
                    this.client.publish(topics.client(guestDeviceId), JSON.stringify({
                        type: 'SYNC_STATE',
                        payload: mergedSnapshot,
                        senderRole: 'host',
                        isInitialSync: false,
                        timestamp: Date.now()
                    }), { qos: 1 });
                }
            }
        });

        this.client.on('offline', () => {
            if (!this.isManualDisconnect) this._emitStatus('reconnecting');
        });

        this.client.on('reconnect', () => {
            if (!this.isManualDisconnect) this._emitStatus('reconnecting');
        });
    }

    // Host bấm "Đồng ý" cho thiết bị phụ vào phòng
    approveGuest(guestDeviceId) {
        if (this.role !== 'host' || !this.client || !this.roomCode) return;
        const req = this.pendingRequests.get(guestDeviceId);
        const existing = this.authorizedDevices[guestDeviceId];

        const deviceName = req?.deviceName || existing?.deviceName || 'Thiết bị giám thị';
        const issuedToken = existing?.token || `TOK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

        this.authorizedDevices[guestDeviceId] = {
            token: issuedToken,
            deviceName,
            approvedAt: Date.now()
        };
        this._saveAuthorizedDevices();

        this.pendingRequests.delete(guestDeviceId);
        this.activeGuests.set(guestDeviceId, Date.now());
        this._emitStatus('connected');

        this._sendApprovalAndState(guestDeviceId, issuedToken);
        this.onToast(`Đã cấp quyền kết nối cho "${deviceName}"`, 'success');
    }

    // Host bấm "Từ chối" yêu cầu tham gia
    rejectGuest(guestDeviceId) {
        if (this.role !== 'host' || !this.client || !this.roomCode) return;
        const req = this.pendingRequests.get(guestDeviceId);
        this.pendingRequests.delete(guestDeviceId);
        this._emitStatus('connected');

        const topics = this._topics(this.roomCode);
        this.client.publish(topics.client(guestDeviceId), JSON.stringify({
            type: 'AUTH_REJECTED',
            reason: 'Thiết Bị Chính (Host) đã từ chối yêu cầu tham gia phòng thi.'
        }), { qos: 1 });

        if (req) {
            this.onToast(`Đã từ chối yêu cầu từ "${req.deviceName}"`, 'info');
        }
    }

    // Host bấm "Gỡ quyền" một thiết bị phụ khỏi danh sách
    revokeGuest(guestDeviceId) {
        if (this.role !== 'host' || !this.roomCode) return;
        const entry = this.authorizedDevices[guestDeviceId];
        delete this.authorizedDevices[guestDeviceId];
        this._saveAuthorizedDevices();

        this.activeGuests.delete(guestDeviceId);
        this.pendingRequests.delete(guestDeviceId);
        this._emitStatus('connected');

        if (this.client && this.client.connected) {
            const topics = this._topics(this.roomCode);
            this.client.publish(topics.client(guestDeviceId), JSON.stringify({
                type: 'AUTH_REVOKED',
                reason: 'Thiết Bị Chính (Host) đã ngắt quyền truy cập của thiết bị này.'
            }), { qos: 1 });
        }

        if (entry) {
            this.onToast(`Đã gỡ quyền truy cập của "${entry.deviceName}"`, 'warning');
        }
    }

    _sendApprovalAndState(guestDeviceId, token) {
        if (!this.client || !this.client.connected || !this.roomCode) return;
        const topics = this._topics(this.roomCode);
        const currentState = this.getAppState();

        // Đính kèm luôn dữ liệu hiện tại trong AUTH_ACCEPTED để Guest nhận ngay lập tức
        this.client.publish(topics.client(guestDeviceId), JSON.stringify({
            type: 'AUTH_ACCEPTED',
            sessionToken: token,
            initialState: currentState
        }), { qos: 1 });

        this.client.publish(topics.client(guestDeviceId), JSON.stringify({
            type: 'SYNC_STATE',
            payload: currentState,
            senderRole: 'host',
            isInitialSync: true,
            timestamp: Date.now()
        }), { qos: 1 });
    }

    // =========================================================
    // 2. THIẾT BỊ PHỤ (GUEST)
    // =========================================================
    async joinRoom(rawCode, customDeviceName = '', isReconnect = false) {
        const cleanCode = (rawCode || this.roomCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập hoặc quét Mã phòng thi!', 'warning');
            return;
        }

        const savedSession = this._loadSession();
        const savedToken = (savedSession && savedSession.roomCode === cleanCode) ? (savedSession.sessionToken || '') : '';
        const finalDeviceName = (customDeviceName || savedSession?.deviceName || this.defaultDeviceName).trim();

        if (isReconnect && !savedToken) {
            this._clearSession();
            this.role = null;
            this.roomCode = null;
            this._emitStatus('disconnected');
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
        if (savedToken) this._saveSession(finalDeviceName);

        const brokerUrl = WSS_BROKERS[this.brokerIndex % WSS_BROKERS.length];
        const topics = this._topics(cleanCode);
        const myClientTopic = topics.client(this.deviceId);
        const clientId = `SGS_GUEST_${cleanCode}_${this.deviceId}_${Math.random().toString(36).slice(2, 6)}`;

        this._emitStatus(isReconnect ? 'reconnecting' : 'connecting');

        this._clearAuthTimeout();
        this.authTimeoutTimer = setTimeout(() => {
            if (!this.isAuthenticated && !this.isManualDisconnect) {
                this._cleanupClientOnly();
                if (isReconnect && this.sessionToken) {
                    this.brokerIndex += 1;
                    this._emitStatus('reconnecting');
                    this._scheduleReconnect(3000);
                } else {
                    this._clearSession();
                    this.role = null;
                    this.roomCode = null;
                    this._emitStatus('disconnected', `Hết thời gian chờ phản hồi từ phòng "${cleanCode}". Hãy kiểm tra Thiết Bị Chính đang bật chia sẻ.`);
                }
            }
        }, savedToken ? 12000 : 90000);

        this.client = window.mqtt.connect(brokerUrl, {
            clientId,
            clean: true,
            connectTimeout: 5000,
            reconnectPeriod: 2500,
            keepalive: 15
        });

        this.client.on('connect', () => {
            this.client.subscribe([myClientTopic, topics.broadcast], { qos: 1 }, (err) => {
                if (err) return;

                // Luôn lấy this.sessionToken mới nhất (tránh dùng closure savedToken cũ khi auto-reconnect)
                const activeToken = this.sessionToken || savedToken;
                const reconnectingWithToken = Boolean(activeToken);

                this.client.publish(topics.inbox, JSON.stringify({
                    type: 'JOIN_REQUEST',
                    deviceId: this.deviceId,
                    deviceName: finalDeviceName,
                    sessionToken: activeToken,
                    isReconnect: isReconnect || reconnectingWithToken
                }), { qos: 1 });

                if (!activeToken) {
                    this._emitStatus('waiting_approval');
                }
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

            if (topic === myClientTopic) {
                if (data.type === 'AUTH_REJECTED' || data.type === 'AUTH_REVOKED') {
                    this._clearAuthTimeout();
                    const errMsg = data.reason || 'Yêu cầu kết nối bị từ chối.';
                    this.isManualDisconnect = true;
                    this.isAuthenticated = false;
                    this.sessionToken = '';
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
                    const wasReconnect = Boolean(this.sessionToken) || isReconnect;
                    this._clearAuthTimeout();
                    this.reconnectAttempts = 0;
                    this.isAuthenticated = true;
                    this.sessionToken = data.sessionToken || this.sessionToken || savedToken;
                    this._saveSession(finalDeviceName);

                    this._clearReconnectTimer();
                    this._startHeartbeat();
                    this._emitStatus('connected');

                    // Hợp nhất ngay dữ liệu Host gửi kèm trong gói duyệt
                    if (data.initialState) {
                        this.onStateReceived(data.initialState, {
                            senderRole: 'host',
                            isInitialSync: true,
                            isReconnect: wasReconnect
                        });
                    }

                    this.onToast(
                        wasReconnect ? `Đã tự động kết nối lại phòng ${cleanCode}` : `Thiết Bị Chính đã đồng ý! Đang đồng bộ phòng ${cleanCode}`,
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
                        isReconnect: wasReconnect,
                        timestamp: Date.now()
                    }), { qos: 1 });
                    return;
                }

                if (data.type === 'SYNC_STATE' && this.isAuthenticated) {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync,
                        isReconnect: !!data.isReconnect
                    });
                }
                return;
            }

            if (topic === topics.broadcast && this.isAuthenticated) {
                if (data.excludeDeviceId && data.excludeDeviceId === this.deviceId) return;
                if (data.type === 'SYNC_STATE') {
                    this.onStateReceived(data.payload, {
                        senderRole: data.senderRole || 'host',
                        isInitialSync: !!data.isInitialSync,
                        isReconnect: !!data.isReconnect
                    });
                }
            }
        });

        this.client.on('offline', () => {
            if (!this.isManualDisconnect && this.sessionToken) {
                this.isAuthenticated = false;
                this._emitStatus('reconnecting');
            }
        });

        this.client.on('reconnect', () => {
            if (!this.isManualDisconnect && this.sessionToken) {
                this._emitStatus('reconnecting');
            }
        });
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
        if (this.role === 'guest' && this.client && this.client.connected && this.roomCode) {
            try {
                const topics = this._topics(this.roomCode);
                if (this.sessionToken) {
                    this.client.publish(topics.inbox, JSON.stringify({
                        type: 'GUEST_LEAVE',
                        deviceId: this.deviceId,
                        sessionToken: this.sessionToken
                    }));
                } else {
                    this.client.publish(topics.inbox, JSON.stringify({
                        type: 'CANCEL_REQUEST',
                        deviceId: this.deviceId
                    }));
                }
            } catch (_) {}
        }

        this.isManualDisconnect = true;
        this.isAuthenticated = false;
        this.sessionToken = '';
        this.pendingRequests.clear();
        this.activeGuests.clear();
        this.stopQrScanner();
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
                this.joinRoom(saved.roomCode, saved.deviceName || '', true);
            }
        }
        return '';
    }

    _scheduleReconnect(delayMs = 2500) {
        if (this.isManualDisconnect || !this.roomCode || !this.role) return;
        if (this.role === 'guest' && !this.sessionToken) return;

        this._clearReconnectTimer();
        this.reconnectAttempts += 1;
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

    _buildGuestList() {
        const now = Date.now();
        return Object.entries(this.authorizedDevices).map(([devId, info]) => {
            const lastSeen = this.activeGuests.get(devId) || 0;
            const isOnline = (now - lastSeen) <= 40000;
            return {
                deviceId: devId,
                deviceName: info.deviceName || 'Thiết bị giám thị',
                approvedAt: info.approvedAt || now,
                isOnline
            };
        });
    }

    _emitStatus(status, authError = '', hasNewRequest = false) {
        const guestList = this.role === 'host' ? this._buildGuestList() : [];
        const onlineCount = guestList.filter(g => g.isOnline).length;

        this.onStatusChange({
            status,
            role: this.role,
            roomCode: this.roomCode,
            authError,
            hasNewRequest,
            pendingRequests: this.role === 'host' ? Array.from(this.pendingRequests.values()) : [],
            guestList,
            peerCount: onlineCount,
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

    _saveSession(deviceName = '') {
        try {
            localStorage.setItem('SGS_P2P_SESSION', JSON.stringify({
                role: this.role,
                roomCode: this.roomCode,
                sessionToken: this.sessionToken,
                deviceName: deviceName || this.defaultDeviceName,
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
