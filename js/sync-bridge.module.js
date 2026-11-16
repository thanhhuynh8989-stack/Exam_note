import { P2PSyncManager } from '../p2p-sync.js';
import { timerModule } from './timer.module.js';
import { storageModule } from './storage.module.js';

// Bộ đếm thời gian đơn điệu chống lệch đồng hồ giữa các thiết bị Guest và Host
let maxObservedTimestamp = 0;

function trackTimestamp(ts) {
    const num = Number(ts) || 0;
    if (num > maxObservedTimestamp) {
        maxObservedTimestamp = num;
    }
}

function nextMonotonicTimestamp() {
    const ts = Math.max(Date.now(), maxObservedTimestamp + 1);
    maxObservedTimestamp = ts;
    return ts;
}

function getStudentSyncKey(st) {
    const mssv = String(st?.mssv || '').trim().toUpperCase();
    return mssv ? `MSSV:${mssv}` : `ID:${st?.id || ''}`;
}

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

    // Đóng dấu thời gian riêng cho từng phần điểm & từng trường thông tin khi chỉnh sửa cục bộ
    stampStudentUpdates(prevStudents, nextStudents) {
        const now = nextMonotonicTimestamp();
        const prevMap = new Map((prevStudents || []).map(s => [getStudentSyncKey(s), s]));

        return (nextStudents || []).map(st => {
            const key = getStudentSyncKey(st);
            const old = prevMap.get(key);
            const scores = Array.isArray(st.scores) ? [...st.scores] : [];

            if (!old) {
                const initScoreTs = scores.map((_, i) =>
                    (Array.isArray(st.scoreUpdatedAt) && st.scoreUpdatedAt[i]) ? st.scoreUpdatedAt[i] : (st.updatedAt || now)
                );
                return {
                    ...st,
                    scores,
                    scoreUpdatedAt: initScoreTs,
                    isPresentUpdatedAt: st.isPresentUpdatedAt || st.updatedAt || now,
                    assignedExamUpdatedAt: st.assignedExamUpdatedAt || st.updatedAt || now,
                    noteUpdatedAt: st.noteUpdatedAt || st.updatedAt || now,
                    updatedAt: st.updatedAt || now
                };
            }

            const oldScores = Array.isArray(old.scores) ? old.scores : [];
            const oldScoreTs = Array.isArray(old.scoreUpdatedAt) ? old.scoreUpdatedAt : [];
            const baseOldTs = old.updatedAt || 0;

            let anyChanged = false;
            const nextScoreTs = scores.map((val, idx) => {
                const prevVal = oldScores[idx];
                const prevTs = oldScoreTs[idx] ?? baseOldTs;
                if (Number(val ?? 0) !== Number(prevVal ?? 0) || (val !== prevVal)) {
                    anyChanged = true;
                    return now;
                }
                return prevTs;
            });

            const presentChanged = old.isPresent !== st.isPresent;
            const examChanged = (old.assignedExam || '') !== (st.assignedExam || '');
            const noteChanged = (old.note || '') !== (st.note || '');
            const totalChanged = Number(old.totalScore ?? 0) !== Number(st.totalScore ?? 0);

            if (presentChanged || examChanged || noteChanged || totalChanged) {
                anyChanged = true;
            }

            return {
                ...st,
                scores,
                scoreUpdatedAt: nextScoreTs,
                isPresentUpdatedAt: presentChanged ? now : (st.isPresentUpdatedAt || old.isPresentUpdatedAt || baseOldTs),
                assignedExamUpdatedAt: examChanged ? now : (st.assignedExamUpdatedAt || old.assignedExamUpdatedAt || baseOldTs),
                noteUpdatedAt: noteChanged ? now : (st.noteUpdatedAt || old.noteUpdatedAt || baseOldTs),
                updatedAt: anyChanged ? now : (st.updatedAt || baseOldTs || now)
            };
        });
    },

    _recomputeTotalScore(app, studentObj) {
        if (typeof app.calculateTotalScore === 'function') {
            app.calculateTotalScore(studentObj);
            return;
        }
        const sum = (studentObj.scores || []).reduce((acc, v) => acc + (Number(v) || 0), 0);
        studentObj.totalScore = Math.round(sum * 100) / 100;
    },

    mergeRemoteState(app, remote, meta = {}) {
        const isHost = app.syncState.role === 'host';
        const isInitial = !!meta.isInitialSync;
        const isReconnect = !!meta.isReconnect;
        const remoteSender = remote.senderDevice || 'Thiết bị Giám sát';

        if (remote.config && (!isInitial || !isHost)) {
            Object.assign(app.config, remote.config);
        }

        if (remote.picker && (!isInitial || !isHost)) {
            Object.assign(app.picker, remote.picker);
        }

        // Đồng bộ đồng hồ từ Host hoặc từ thao tác điều khiển mới hơn
        if (remote.timer && (!isInitial || !isHost)) {
            const remoteTimerUpdated = remote.timer.updatedAt || 0;
            const localTimerUpdated = app.timer.updatedAt || 0;
            trackTimestamp(remoteTimerUpdated);

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

        // Chỉ hợp nhất danh sách xóa khi không phải Guest mới kết nối lần đầu vào Host
        const allowDeletionMerge = !isInitial || !isHost || isReconnect;
        const deletedSet = new Set([
            ...(app.deletedStudentIds || []),
            ...(allowDeletionMerge && Array.isArray(remote.deletedStudentIds) ? remote.deletedStudentIds : [])
        ]);
        app.deletedStudentIds = Array.from(deletedSet);

        const isDeleted = (st) => deletedSet.has(st.id) || deletedSet.has(st.mssv) || deletedSet.has(getStudentSyncKey(st));
        const autoGeneratedLogs = [];

        if (Array.isArray(remote.students)) {
            const mergedMap = new Map();

            app.students.forEach(localSt => {
                if (!isDeleted(localSt)) {
                    trackTimestamp(localSt.updatedAt);
                    mergedMap.set(getStudentSyncKey(localSt), { ...localSt, updatedAt: localSt.updatedAt || 0 });
                }
            });

            const sectionCount = Array.isArray(app.config?.sections) ? app.config.sections.length : 0;

            remote.students.forEach(remoteSt => {
                if (isDeleted(remoteSt)) return;

                const key = getStudentSyncKey(remoteSt);
                const localSt = mergedMap.get(key);
                const remoteBaseTs = remoteSt.updatedAt || 0;
                trackTimestamp(remoteBaseTs);

                // Nếu Guest mới tham gia lần đầu và Host đã có danh sách -> bỏ qua SV rác từ máy Guest
                if (!localSt) {
                    if (isInitial && isHost && !isReconnect && mergedMap.size > 0) {
                        return;
                    }
                    const cloned = JSON.parse(JSON.stringify(remoteSt));
                    this._recomputeTotalScore(app, cloned);
                    mergedMap.set(key, cloned);
                    return;
                }

                const localBaseTs = localSt.updatedAt || 0;
                const mergedSt = { ...localSt };

                // 1. Hợp nhất trạng thái Điểm danh theo mốc thời gian riêng
                const localAttTs = localSt.isPresentUpdatedAt ?? localBaseTs;
                const remoteAttTs = remoteSt.isPresentUpdatedAt ?? remoteBaseTs;
                trackTimestamp(remoteAttTs);

                if (remoteAttTs > localAttTs) {
                    if (localSt.isPresent !== remoteSt.isPresent) {
                        autoGeneratedLogs.push({
                            id: `sync-${remoteAttTs}-${key}-att`,
                            timestamp: remoteAttTs,
                            time: new Date(remoteAttTs || Date.now()).toLocaleTimeString('vi-VN'),
                            device: remoteSender,
                            text: `Điểm danh ${remoteSt.hoLot} ${remoteSt.ten} (${remoteSt.mssv}): ${remoteSt.isPresent ? 'Có mặt' : 'Vắng thi'}`
                        });
                    }
                    mergedSt.isPresent = remoteSt.isPresent;
                    mergedSt.isPresentUpdatedAt = remoteAttTs;
                }

                // 2. Hợp nhất Mã đề đã bốc
                const localExamTs = localSt.assignedExamUpdatedAt ?? localBaseTs;
                const remoteExamTs = remoteSt.assignedExamUpdatedAt ?? remoteBaseTs;
                trackTimestamp(remoteExamTs);
                if (remoteExamTs > localExamTs) {
                    mergedSt.assignedExam = remoteSt.assignedExam;
                    mergedSt.assignedExamUpdatedAt = remoteExamTs;
                }

                // 3. Hợp nhất Ghi chú
                const localNoteTs = localSt.noteUpdatedAt ?? localBaseTs;
                const remoteNoteTs = remoteSt.noteUpdatedAt ?? remoteBaseTs;
                trackTimestamp(remoteNoteTs);
                if (remoteNoteTs > localNoteTs) {
                    mergedSt.note = remoteSt.note;
                    mergedSt.noteUpdatedAt = remoteNoteTs;
                }

                // 4. Hợp nhất ĐIỂM TỪNG PHẦN THI ĐỘC LẬP (Không ghi đè chéo giữa các giám thị)
                const localScores = Array.isArray(localSt.scores) ? [...localSt.scores] : [];
                const remoteScores = Array.isArray(remoteSt.scores) ? remoteSt.scores : [];
                const localScoreTs = Array.isArray(localSt.scoreUpdatedAt) ? [...localSt.scoreUpdatedAt] : [];
                const remoteScoreTs = Array.isArray(remoteSt.scoreUpdatedAt) ? remoteSt.scoreUpdatedAt : [];

                const maxLen = Math.max(sectionCount, localScores.length, remoteScores.length);
                let anyScoreUpdated = false;

                for (let i = 0; i < maxLen; i++) {
                    const lVal = localScores[i] ?? 0;
                    const rVal = remoteScores[i] ?? 0;
                    const lTs = localScoreTs[i] ?? localBaseTs;
                    const rTs = remoteScoreTs[i] ?? remoteBaseTs;
                    trackTimestamp(rTs);

                    if (rTs > lTs) {
                        if (Number(lVal) !== Number(rVal)) {
                            anyScoreUpdated = true;
                        }
                        localScores[i] = rVal;
                        localScoreTs[i] = rTs;
                    } else {
                        localScores[i] = lVal;
                        localScoreTs[i] = lTs;
                    }
                }

                mergedSt.scores = localScores;
                mergedSt.scoreUpdatedAt = localScoreTs;
                const prevTotal = Number(localSt.totalScore ?? 0);
                this._recomputeTotalScore(app, mergedSt);

                if (anyScoreUpdated || Number(mergedSt.totalScore ?? 0) !== prevTotal) {
                    const scoreLogTs = Math.max(...localScoreTs, remoteBaseTs, Date.now());
                    autoGeneratedLogs.push({
                        id: `sync-${scoreLogTs}-${key}-score`,
                        timestamp: scoreLogTs,
                        time: new Date(scoreLogTs).toLocaleTimeString('vi-VN'),
                        device: remoteSender,
                        text: `Cập nhật điểm ${mergedSt.hoLot} ${mergedSt.ten} (${mergedSt.mssv}): ${mergedSt.totalScore ?? 0}đ`
                    });
                }

                mergedSt.updatedAt = Math.max(
                    localBaseTs,
                    remoteBaseTs,
                    mergedSt.isPresentUpdatedAt || 0,
                    mergedSt.assignedExamUpdatedAt || 0,
                    mergedSt.noteUpdatedAt || 0,
                    ...localScoreTs
                );

                mergedMap.set(key, mergedSt);
            });

            app.students = Array.from(mergedMap.values());
        }

        // Hợp nhất nhật ký từ tất cả thiết bị
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
