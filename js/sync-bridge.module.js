import { P2PSyncManager } from '../p2p-sync.js';
import { timerModule } from './timer.module.js';
import { storageModule } from './storage.module.js';

export const syncBridgeModule = {
    init(app) {
        app._syncManager = new P2PSyncManager({
            prefix: 'SGS-EXAM-',
            getAppState: () => ({
                senderDevice: app.getDeviceActorLabel(),
                config: JSON.parse(JSON.stringify(app.config)),
                timer: {
                    timeLeft: app.timer.timeLeft,
                    isRunning: app.timer.isRunning,
                    updatedAt: app.timer.updatedAt || 0
                },
                students: JSON.parse(JSON.stringify(app.students)),
                deletedStudentIds: JSON.parse(JSON.stringify(app.deletedStudentIds || [])),
                picker: {
                    rawExamList: app.picker.rawExamList,
                    currentDisplay: app.picker.currentDisplay,
                    allowDuplicate: app.picker.allowDuplicate
                },
                logs: JSON.parse(JSON.stringify(app.logs))
            }),
            onStateReceived: (remote, meta = {}) => {
                app._isApplyingRemote = true;
                try {
                    this.mergeRemoteState(app, remote, meta);
                    storageModule.saveToLocalStorage(app);
                    app._lastSavedStudents = JSON.parse(JSON.stringify(app.students));
                    app._lastSavedConfigStr = JSON.stringify(app.config || {});
                } finally {
                    app._isApplyingRemote = false;
                }
            },
            onStatusChange: (info) => {
                app.syncState.status = info.status;
                app.syncState.role = info.role;
                app.syncState.roomCode = info.roomCode || '';
                app.syncState.peerCount = info.peerCount || 0;
                app.syncState.authError = info.authError || '';
                app.syncState.pendingRequests = info.pendingRequests || [];
                app.syncState.guestList = info.guestList || [];

                if (info.hasNewRequest && info.role === 'host') {
                    app.syncState.showModal = true;
                }

                if (info.status === 'connected' && info.role === 'host' && info.joinUrl) {
                    app.$nextTick(() => this.renderQrCode(info.joinUrl));
                }
            },
            onToast: (msg, type) => app.triggerToast(msg, type)
        });

        app.syncState.deviceName = app._syncManager.defaultDeviceName || '';

        const roomFromUrl = app._syncManager.checkAutoJoinFromUrl();
        if (roomFromUrl) {
            app.syncState.inputCode = roomFromUrl;
            app.syncState.showModal = true;
        }
    },

    renderQrCode(url) {
        const box = document.getElementById('p2p-qrcode-box');
        if (!box || !window.QRCode) return;
        box.innerHTML = '';
        new window.QRCode(box, {
            text: url,
            width: 168,
            height: 168,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.M
        });
    },

    stampStudentUpdates(prevStudents, nextStudents) {
        const now = Date.now();
        const prevMap = new Map((prevStudents || []).map(s => [s.id || s.mssv, s]));

        return (nextStudents || []).map(st => {
            const key = st.id || st.mssv;
            const old = prevMap.get(key);
            if (!old) {
                return { ...st, updatedAt: st.updatedAt || now };
            }
            const changed =
                old.isPresent !== st.isPresent ||
                old.assignedExam !== st.assignedExam ||
                old.totalScore !== st.totalScore ||
                JSON.stringify(old.scores || []) !== JSON.stringify(st.scores || []);

            return {
                ...st,
                updatedAt: changed ? now : (st.updatedAt || old.updatedAt || now)
            };
        });
    },

    mergeRemoteState(app, remote, meta = {}) {
        const isHost = app.syncState.role === 'host';
        const isInitial = !!meta.isInitialSync;
        const remoteSender = remote.senderDevice || 'Thiết bị Giám sát';

        if (remote.config && (!isInitial || !isHost)) {
            Object.assign(app.config, remote.config);
        }

        if (remote.picker && (!isInitial || !isHost)) {
            Object.assign(app.picker, remote.picker);
        }

        // Chỉ đồng bộ đồng hồ từ Host hoặc khi có thao tác điều khiển đồng hồ mới hơn
        if (remote.timer && (!isInitial || !isHost)) {
            const remoteTimerUpdated = remote.timer.updatedAt || 0;
            const localTimerUpdated = app.timer.updatedAt || 0;
            if (!isHost || remoteTimerUpdated > localTimerUpdated) {
                app.timer.timeLeft = remote.timer.timeLeft;
                app.timer.updatedAt = Math.max(localTimerUpdated, remoteTimerUpdated);
                if (remote.timer.isRunning && !app.timer.isRunning) {
                    timerModule.toggleTimer(app, true);
                } else if (!remote.timer.isRunning && app.timer.isRunning) {
                    timerModule.toggleTimer(app, true);
                }
            }
        }

        // Hợp nhất danh sách thí sinh đã xóa để không bị hồi sinh khi đồng bộ
        const deletedSet = new Set([
            ...(app.deletedStudentIds || []),
            ...(Array.isArray(remote.deletedStudentIds) ? remote.deletedStudentIds : [])
        ]);
        app.deletedStudentIds = Array.from(deletedSet);

        const autoGeneratedLogs = [];

        if (Array.isArray(remote.students)) {
            const mergedMap = new Map();

            app.students.forEach(localSt => {
                const key = localSt.id || localSt.mssv;
                if (!deletedSet.has(key)) {
                    mergedMap.set(key, { ...localSt, updatedAt: localSt.updatedAt || 0 });
                }
            });

            remote.students.forEach(remoteSt => {
                const key = remoteSt.id || remoteSt.mssv;
                if (deletedSet.has(key)) return;

                const localSt = mergedMap.get(key);
                const remoteTime = remoteSt.updatedAt || 0;

                if (!localSt || remoteTime > (localSt.updatedAt || 0)) {
                    if (localSt) {
                        if (localSt.isPresent !== remoteSt.isPresent) {
                            autoGeneratedLogs.push({
                                id: `sync-${remoteTime}-${key}-att`,
                                timestamp: remoteTime,
                                time: new Date(remoteTime || Date.now()).toLocaleTimeString('vi-VN'),
                                device: remoteSender,
                                text: `Điểm danh ${remoteSt.hoLot} ${remoteSt.ten} (${remoteSt.mssv}): ${remoteSt.isPresent ? 'Có mặt' : 'Vắng thi'}`
                            });
                        }
                        if (localSt.totalScore !== remoteSt.totalScore || JSON.stringify(localSt.scores || []) !== JSON.stringify(remoteSt.scores || [])) {
                            autoGeneratedLogs.push({
                                id: `sync-${remoteTime}-${key}-score`,
                                timestamp: remoteTime,
                                time: new Date(remoteTime || Date.now()).toLocaleTimeString('vi-VN'),
                                device: remoteSender,
                                text: `Cập nhật điểm ${remoteSt.hoLot} ${remoteSt.ten} (${remoteSt.mssv}): ${remoteSt.totalScore ?? 0}đ`
                            });
                        }
                    }
                    mergedMap.set(key, { ...remoteSt, updatedAt: remoteTime });
                }
            });

            app.students = Array.from(mergedMap.values());
        }

        // Hợp nhất nhật ký từ tất cả các thiết bị theo thứ tự mới nhất lên đầu
        const incomingLogs = [
            ...(Array.isArray(remote.logs) ? remote.logs : []),
            ...autoGeneratedLogs
        ];

        if (incomingLogs.length > 0) {
            const seen = new Set();
            const combined = [...app.logs, ...incomingLogs].filter(item => {
                if (!item || !item.text) return false;
                const sig = item.id || `${item.time}|${item.device || ''}|${item.text}`;
                if (seen.has(sig)) return false;
                seen.add(sig);
                return true;
            });

            combined.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            if (combined.length > 500) combined.length = 500;
            app.logs = combined;
        }
    }
};
