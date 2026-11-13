// p2p-sync.js - Module Đồng bộ Thời gian thực P2P (WebRTC / PeerJS)

export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'SGS-EXAM-';
        this.peer = null;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.connections = [];
        this.hostConn = null;

        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));
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

    async startHost(customCode = null) {
        await this.ensurePeerLibrary();
        this.disconnect(false);

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || `THI-${randomDigits}`;
        const peerId = `${this.prefix}${this.roomCode}`;

        this.onStatusChange({ status: 'connecting', role: 'host', roomCode: this.roomCode, peerCount: 0 });

        this.peer = new window.Peer(peerId, { debug: 1 });

        this.peer.on('open', () => {
            this.role = 'host';
            this.onStatusChange({
                status: 'connected',
                role: 'host',
                roomCode: this.roomCode,
                peerCount: 0,
                joinUrl: this.buildJoinUrl(this.roomCode)
            });
            this.onToast(`Đã mở cổng đồng bộ: ${this.roomCode}`, 'success');
        });

        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.connections.push(conn);
                this._notifyHostPeerCount();
                this.onToast('Một thiết bị giám thị vừa kết nối!', 'info');

                conn.send({
                    type: 'FULL_SYNC',
                    payload: this.getAppState(),
                    timestamp: Date.now()
                });
            });

            conn.on('data', (data) => {
                if (data && data.type === 'FULL_SYNC') {
                    this.onStateReceived(data.payload);
                    this.broadcast(data.payload, conn.peer);
                }
            });

            conn.on('close', () => {
                this.connections = this.connections.filter(c => c.peer !== conn.peer);
                this._notifyHostPeerCount();
                this.onToast('Một thiết bị đã ngắt kết nối.', 'warning');
            });
        });

        this.peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                this.startHost();
            } else {
                this.onToast(`Lỗi kết nối P2P: ${err.type}`, 'error');
                this.disconnect(false);
            }
        });
    }

    async joinRoom(rawCode) {
        const cleanCode = (rawCode || '').trim().toUpperCase();
        if (!cleanCode) {
            this.onToast('Vui lòng nhập mã phòng thi!', 'warning');
            return;
        }

        await this.ensurePeerLibrary();
        this.disconnect(false);

        this.roomCode = cleanCode;
        const targetPeerId = `${this.prefix}${cleanCode}`;

        this.onStatusChange({ status: 'connecting', role: 'guest', roomCode: cleanCode, peerCount: 0 });

        this.peer = new window.Peer({ debug: 1 });

        this.peer.on('open', () => {
            const conn = this.peer.connect(targetPeerId, { reliable: true });
            this.hostConn = conn;

            conn.on('open', () => {
                this.role = 'guest';
                this.onStatusChange({
                    status: 'connected',
                    role: 'guest',
                    roomCode: cleanCode,
                    peerCount: 1
                });
                this.onToast(`Đã đồng bộ trực tiếp với phòng ${cleanCode}`, 'success');
            });

            conn.on('data', (data) => {
                if (data && data.type === 'FULL_SYNC') {
                    this.onStateReceived(data.payload);
                }
            });

            conn.on('close', () => {
                this.onToast('Mất kết nối với máy chủ phòng thi!', 'error');
                this.disconnect(false);
            });
        });

        this.peer.on('error', (err) => {
            this.onToast(`Không tìm thấy phòng ${cleanCode} (${err.type})`, 'error');
            this.disconnect(false);
        });
    }

    broadcast(statePayload, excludePeerId = null) {
        if (!this.role) return;

        const message = {
            type: 'FULL_SYNC',
            payload: statePayload,
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
        if (this.hostConn) {
            this.hostConn.close();
            this.hostConn = null;
        }
        this.connections.forEach(c => c.close());
        this.connections = [];

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.role = null;
        this.roomCode = null;
        this.onStatusChange({ status: 'disconnected', role: null, roomCode: null, peerCount: 0 });
        if (notify) this.onToast('Đã tắt đồng bộ trực tiếp.', 'info');
    }

    buildJoinUrl(roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    checkAutoJoinFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            this.joinRoom(roomParam);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    _notifyHostPeerCount() {
        this.onStatusChange({
            status: 'connected',
            role: 'host',
            roomCode: this.roomCode,
            peerCount: this.connections.length,
            joinUrl: this.buildJoinUrl(this.roomCode)
        });
    }
}
