import { P2PSyncManager } from '../p2p-sync.js';
import { timerModule } from './timer.module.js';
import { storageModule } from './storage.module.js';

export const syncBridgeModule = {
    init(app) {
        app._syncManager = new P2PSyncManager({
            prefix: 'SGS-EXAM-',
            getAppState: () => ({
                config: JSON.parse(JSON.stringify(app.config)),
                timer: {
                    timeLeft: app.timer.timeLeft,
                    isRunning: app.timer.isRunning
                },
                students: JSON.parse(JSON.stringify(app.students)),
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

        if (remote.config && (!isInitial || !isHost)) {
            Object.assign(app.config, remote.config);
        }

        if (remote.picker && (!isInitial || !isHost)) {
            Object.assign(app.picker, remote.picker);
        }

        if (remote.timer && (!isInitial || !isHost)) {
            app.timer.timeLeft = remote.timer.timeLeft;
            if (remote.timer.isRunning && !app.timer.isRunning) {
                timerModule.toggleTimer(app);
            } else if (!remote.timer.isRunning && app.timer.isRunning) {
                timerModule.toggleTimer(app);
            }
        }

        if (Array.isArray(remote.students)) {
            const mergedMap = new Map();

            app.students.forEach(localSt => {
                const key = localSt.id || localSt.mssv;
                mergedMap.set(key, { ...localSt, updatedAt: localSt.updatedAt || 0 });
            });

            remote.students.forEach(remoteSt => {
                const key = remoteSt.id || remoteSt.mssv;
                const localSt = mergedMap.get(key);
                const remoteTime = remoteSt.updatedAt || 0;

                if (!localSt || remoteTime >= (localSt.updatedAt || 0)) {
                    mergedMap.set(key, { ...remoteSt, updatedAt: remoteTime });
                }
            });

            app.students = Array.from(mergedMap.values());
        }

        if (Array.isArray(remote.logs)) {
            const seen = new Set();
            app.logs = [...app.logs, ...remote.logs].filter(item => {
                const sig = `${item.time}|${item.text}`;
                if (seen.has(sig)) return false;
                seen.add(sig);
                return true;
            });
        }
    }
};
