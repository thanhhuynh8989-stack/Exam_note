// p2p-sync.js - Module Đồng bộ Thời gian thực P2P (WebRTC / PeerJS)

export class P2PSyncManager {
    constructor(options = {}) {
        this.prefix = options.prefix || 'EXAM-';
        this.peer = null;
        this.role = null; // 'host' | 'guest' | null
        this.roomCode = null;
        this.connections = []; // Danh sách máy khách (dành cho Host)
        this.hostConn = null;  // Kết nối tới máy chủ (dành cho Guest)

        // Các hàm callback để giao tiếp ngược lại với giao diện chính
        this.getAppState = options.getAppState || (() => ({}));
        this.onStateReceived = options.onStateReceived || (() => {});
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onToast = options.onToast || ((msg) => console.log(msg));
    }

    // Tự động nạp thư viện PeerJS từ CDN nếu chưa tồn tại
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

    // Khởi tạo phòng thi (Chế độ Máy chủ / Host)
    async startHost(customCode = null) {
        await this.ensurePeerLibrary();
        this.disconnect(false);

        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        this.roomCode = customCode || `THI-${randomDigits}`;
        const peerId = `${this.prefix}${this.roomCode}`;

        this.onStatusChange({ status: 'connecting', role: 'host', roomCode: this.roomCode });

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

        // Lắng nghe thiết bị khác kết nối vào
        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.connections.push(conn);
                this._notifyHostPeerCount();
                this.onToast('Một thiết bị giám thị vừa kết nối!', 'info');

                // Gửi ngay toàn bộ trạng thái hiện tại cho máy mới vào
                conn.send({
                    type: 'FULL_SYNC',
                    payload: this.getAppState(),
                    timestamp: Date.now()
                });
            });

            // Nhận cập nhật 2 chiều từ thiết bị phụ (điểm danh, bốc thăm...)
            conn.on('data', (data) => {
                if (data && data.type === 'FULL_SYNC') {
                    this.onStateReceived(data.payload);
                    // Chuyển tiếp dữ liệu mới cho các máy phụ còn lại
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
                // Trùng mã phòng -> tự tạo mã khác
                this.startHost();
            } else {
                this.onToast(`Lỗi kết nối P2P: ${err.type}`, 'error');
                this.disconnect();
            }
        });
    }

    // Tham gia phòng thi có sẵn (Chế độ Thiết bị phụ / Guest)
    async joinRoom(rawCode) {
        const cleanCode = rawCode.trim().toUpperCase();
        if (!cleanCode) return;

        await this.ensurePeerLibrary();
        this.disconnect(false);

        this.roomCode = cleanCode;
        const targetPeerId = `${this.prefix}${cleanCode}`;

        this.onStatusChange({ status: 'connecting', role: 'guest', roomCode: cleanCode });

        this.peer = new window.Peer({ debug: 1 });

        this.peer.on('open', () => {
            const conn = this.peer.connect(targetPeerId, { reliable: true });
            this.hostConn = conn;

            conn.on('open', () => {
                this.role = 'guest';
                this.onStatusChange({
                    status: 'connected',
                    role: 'guest',
                    roomCode: cleanCode
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
                this.disconnect();
            });
        });

        this.peer.on('error', (err) => {
            this.onToast(`Không tìm thấy phòng ${cleanCode} (${err.type})`, 'error');
            this.disconnect();
        });
    }

    // Phát tán dữ liệu mới mỗi khi trạng thái ứng dụng thay đổi
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

    // Ngắt kết nối và dọn dẹp tài nguyên
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

    // Tạo URL tham gia nhanh (dùng để sinh mã QR)
    buildJoinUrl(roomCode) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        return url.toString();
    }

    // Tự động kiểm tra tham số ?room=XXXX trên URL khi mở trang (từ quét QR)
    checkAutoJoinFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            this.joinRoom(roomParam);
            // Xóa param trên thanh địa chỉ cho gọn sau khi nhận diện
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
