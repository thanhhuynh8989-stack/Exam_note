import { timerModule } from './js/timer.module.js';
import { pickerModule } from './js/picker.module.js';
import { studentModule } from './js/student.module.js';
import { configModule } from './js/config.module.js';
import { storageModule } from './js/storage.module.js';
import { printModule } from './js/print.module.js';
import { P2PSyncManager } from './p2p-sync.js';

// Lắng nghe sự kiện Alpine khởi tạo
document.addEventListener('alpine:init', () => {
    
    // Đăng ký component examApp chuẩn theo Alpine 3.x
    Alpine.data('examApp', () => ({
        activeTab: 'timer',
        currentSystemTime: '',
        showAddStudentModal: false,
        showGradingModal: false,
        activeStudent: null,
        targetStudentId: null,
        newLogText: '',
        toasts: [],
        confirmModal: { show: false, title: '', message: '', onConfirm: null },

        // Trạng thái cổng Đồng bộ trực tiếp P2P
        syncState: {
            showModal: false,
            status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
            role: null,             // 'host' | 'guest' | null
            roomCode: '',
            inputCode: '',
            peerCount: 0
        },
        _syncManager: null,
        _isApplyingRemote: false,
        _lastSavedStudents: [],
        
        timer: { timeLeft: 60 * 60, isRunning: false, intervalId: null },
        config: {
            examTitle: 'DANH SÁCH SINH VIÊN DỰ THI KTHP',
            academicYear: '2026-2027',
            subjectName: 'Sinh Học Đại Cương',
            subjectCode: 'BIO101',
            subClass: 'C1',
            credits: '1',
            semester: '1',
            examAttempt: '1',
            examTime: '07h00 - Ngày 08/11/2026',
            durationMinutes: 45,
            roomName: '116',
            facility: 'K7/25 Quang Trung',
            examiner1: 'HUỲNH NGỌC THÀNH',
            examiner2: '',
            sections: [
                { title: 'Tiêu bản tự chọn', maxScore: 5, note: 'Vẽ hình và trình bày' },
                { title: 'Bài thi chỉ định', maxScore: 5, note: 'Quan sát đặc điểm' }
            ]
        },
        picker: { 
            rawExamList: "Đề 1\nĐề 2\nĐề 3\nĐề 4\nĐề 5\nĐề 6\nĐề 7\nĐề 8", 
            currentDisplay: "", 
            isSpinning: false, 
            targetStudentId: "",
            allowDuplicate: false 
        },
        students: [],
        newStudent: { mssv: '', hoLot: '', ten: '', className: '' },
        logs: [],

        initApp() {
            setInterval(() => { this.currentSystemTime = new Date().toLocaleTimeString('vi-VN'); }, 1000);
            this.loadFromLocalStorage();
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students || []));
            if (!this.timer.timeLeft || this.timer.timeLeft <= 0) {
                this.timer.timeLeft = (this.config.durationMinutes || 45) * 60;
            }
            this.initSyncModule();
        },

        // Khởi tạo module đồng bộ P2P (WebRTC / PeerJS) có Auto-Reconnect & Smart Merge
        initSyncModule() {
            this._syncManager = new P2PSyncManager({
                prefix: 'SGS-EXAM-',
                getAppState: () => ({
                    config: JSON.parse(JSON.stringify(this.config)),
                    timer: {
                        timeLeft: this.timer.timeLeft,
                        isRunning: this.timer.isRunning
                    },
                    students: JSON.parse(JSON.stringify(this.students)),
                    picker: {
                        rawExamList: this.picker.rawExamList,
                        currentDisplay: this.picker.currentDisplay,
                        allowDuplicate: this.picker.allowDuplicate
                    },
                    logs: JSON.parse(JSON.stringify(this.logs))
                }),
                onStateReceived: (remote, meta = {}) => {
                    this._isApplyingRemote = true;
                    try {
                        this.mergeRemoteState(remote, meta);
                        storageModule.saveToLocalStorage(this);
                        this._lastSavedStudents = JSON.parse(JSON.stringify(this.students));
                    } finally {
                        this._isApplyingRemote = false;
                    }
                },
                onStatusChange: (info) => {
                    this.syncState.status = info.status;
                    this.syncState.role = info.role;
                    this.syncState.roomCode = info.roomCode || '';
                    this.syncState.peerCount = info.peerCount || 0;

                    if (info.joinUrl) {
                        this.$nextTick(() => {
                            const qrBox = document.getElementById('p2p-qrcode-box');
                            if (qrBox && window.QRCode) {
                                qrBox.innerHTML = '';
                                new window.QRCode(qrBox, { text: info.joinUrl, width: 160, height: 160 });
                            }
                        });
                    }
                },
                onToast: (msg, type) => this.triggerToast(msg, type)
            });

            // Tự động kết nối nếu mở từ đường dẫn quét QR (?room=THI-XXXX) hoặc khôi phục phiên
            this._syncManager.checkAutoJoinFromUrl();
        },

        // Gắn dấu thời gian cập nhật (updatedAt) cho từng sinh viên khi điểm danh, bốc đề hoặc chấm điểm
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

        // Bộ hợp nhất dữ liệu thông minh (Smart Merge) giữa các thiết bị khi tái kết nối
        mergeRemoteState(remote, meta = {}) {
            const isHost = this.syncState.role === 'host';
            const isInitial = !!meta.isInitialSync;

            // 1. Cấu hình, Danh sách đề & Đồng hồ:
            // Khi tái kết nối (isInitialSync), Host giữ quyền chuẩn về đồng hồ & cấu hình;
            // Khi đang kết nối trực tiếp bình thường, nhận cập nhật từ máy vừa thao tác.
            if (remote.config && (!isInitial || !isHost)) {
                Object.assign(this.config, remote.config);
            }

            if (remote.picker && (!isInitial || !isHost)) {
                Object.assign(this.picker, remote.picker);
            }

            if (remote.timer && (!isInitial || !isHost)) {
                this.timer.timeLeft = remote.timer.timeLeft;
                if (remote.timer.isRunning && !this.timer.isRunning) {
                    timerModule.toggleTimer(this);
                } else if (!remote.timer.isRunning && this.timer.isRunning) {
                    timerModule.toggleTimer(this);
                }
            }

            // 2. Hợp nhất danh sách Sinh viên (giữ bản ghi có updatedAt mới nhất cho từng SV)
            if (Array.isArray(remote.students)) {
                const mergedMap = new Map();

                this.students.forEach(localSt => {
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

                this.students = Array.from(mergedMap.values());
            }

            // 3. Hợp nhất Nhật ký phòng thi (gộp đủ cả 2 máy, loại bỏ dòng trùng)
            if (Array.isArray(remote.logs)) {
                const seen = new Set();
                const combined = [...this.logs, ...remote.logs].filter(item => {
                    const sig = `${item.time}|${item.text}`;
                    if (seen.has(sig)) return false;
                    seen.add(sig);
                    return true;
                });
                this.logs = combined;
            }
        },

        // Các hàm điều khiển nút bấm trong Modal Đồng bộ
        startLiveSyncHost() {
            this._syncManager?.startHost();
        },
        joinLiveSyncRoom() {
            this._syncManager?.joinRoom(this.syncState.inputCode);
        },
        disconnectLiveSync() {
            this._syncManager?.disconnect(true);
        },
        copySyncCode() {
            if (!this.syncState.roomCode) return;
            navigator.clipboard.writeText(this.syncState.roomCode);
            this.triggerToast(`Đã sao chép mã phòng: ${this.syncState.roomCode}`, 'success');
        },
        broadcastSyncState() {
            if (!this._isApplyingRemote && this._syncManager) {
                this._syncManager.broadcast(this._syncManager.getAppState());
            }
        },

        triggerToast(message, type = 'info') {
            const id = Date.now();
            this.toasts.push({ id, message, type, visible: true });
            setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 3500);
        },
        removeToast(id) { this.toasts = this.toasts.filter(t => t.id !== id); },
        executeConfirmAction() {
            if (typeof this.confirmModal.onConfirm === 'function') this.confirmModal.onConfirm();
            this.confirmModal.show = false;
        },
        toggleFullscreen() {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else if (document.exitFullscreen) document.exitFullscreen();
        },

        // Timer actions (kèm phát tán trạng thái đồng bộ khi thao tác trực tiếp)
        toggleTimer() {
            timerModule.toggleTimer(this);
            this.broadcastSyncState();
        },
        resetTimer() {
            timerModule.resetTimer(this);
            this.broadcastSyncState();
        },
        adjustHours(amount) {
            timerModule.adjustHours(this, amount);
            this.broadcastSyncState();
        },
        adjustMinutes(amount) {
            timerModule.adjustMinutes(this, amount);
            this.broadcastSyncState();
        },
        addExtraMinutes(mins) {
            timerModule.addExtraMinutes(this, mins);
            this.broadcastSyncState();
        },
        setQuickDuration(mins) {
            timerModule.setQuickDuration(this, mins);
            this.broadcastSyncState();
        },
        formatTime(s) { return timerModule.formatTime(s); },
        addLog() {
            timerModule.addLog(this);
            this.broadcastSyncState();
        },

        // Picker actions
        getExamListArray() { return pickerModule.getExamListArray(this); },
        getAvailableExams() { return this.getExamListArray(); },
        startRandomDraw() { pickerModule.startRandomDraw(this); },
        handleTargetStudentChange() {
            const totalExams = this.getExamListArray().length;
            const totalStudents = this.students.length;
            
            if (this.picker.targetStudentId === 'ALL' && totalExams < totalStudents && totalStudents > 0) {
                this.picker.allowDuplicate = true;
                this.triggerToast(`Số lượng đề (${totalExams}) ít hơn số SV (${totalStudents}). Đã tự động bật cho phép trùng đề!`, 'warning');
            }
        },

        // Student actions
        openGradingModal(st) { studentModule.openGradingModal(this, st); },
        calculateTotalScore(st) { studentModule.calculateTotalScore(this, st); },
        toggleAttendance(st) { studentModule.toggleAttendance(this, st); },
        saveManualStudent() { studentModule.saveManualStudent(this); },
        confirmDeleteStudent(st) { studentModule.confirmDeleteStudent(this, st); },

        // Validation & Lưu Chấm điểm
        hasGradingError() {
            if (!this.activeStudent || !this.activeStudent.scores || !this.config.sections) return false;
            return this.config.sections.some((sec, idx) => {
                const score = Number(this.activeStudent.scores[idx]) || 0;
                return score > Number(sec.maxScore);
            });
        },
        
        saveGradingModal() {
            if (this.hasGradingError()) {
                this.triggerToast("Có phần thi nhập vượt quá điểm tối đa, vui lòng kiểm tra lại!", "error");
                return;
            }
        
            const target = this.students.find(s => s.id === this.targetStudentId || s.id === (this.activeStudent && this.activeStudent.id));
            if (target) {
                target.scores = [...this.activeStudent.scores];
                target.totalScore = this.activeStudent.totalScore;
                target.updatedAt = Date.now();
                
                this.saveToLocalStorage();
                this.triggerToast("Đã lưu bảng điểm thành công!", "success");
            }
        
            this.showGradingModal = false;
            this.activeStudent = null;
        },

        // Config actions
        getTotalPoints() { return configModule.getTotalPoints(this); },
        addSection() { configModule.addSection(this); },
        removeSection(idx) { configModule.removeSection(this, idx); },

        // Print A4 Sheet action
        printExamSheet() {
            printModule.printExamSheet(this);
        },

        // Storage & Excel actions
        downloadStudentTemplate() { storageModule.downloadStudentTemplate(); },
        handleStudentExcelUpload(e) { storageModule.handleStudentExcelUpload(this, e); },
        exportToExcelXLSX() { storageModule.exportToExcelXLSX(this); },
        
        clearLocalStorageDraft() {
            this.confirmModal = {
                show: true,
                title: "Xóa Bản Nháp",
                message: "Bạn có chắc chắn muốn xóa toàn bộ bản nháp và làm mới không?",
                onConfirm: () => {
                    localStorage.removeItem('EXAM_MONITOR_DATA_V5');
                    this.students = [];
                    this.logs = [];
                    this._lastSavedStudents = [];
                    this.broadcastSyncState();
                    this.triggerToast("Đã xóa bản nháp thành công!", "info");
                }
            };
        },
        saveToLocalStorage() {
            if (!this._isApplyingRemote) {
                this.students = this.stampStudentUpdates(this._lastSavedStudents || [], this.students);
            }
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students));

            storageModule.saveToLocalStorage(this);
            // Tự động phát tán dữ liệu sang các máy khác mỗi khi bất kỳ module nào gọi saveToLocalStorage()
            this.broadcastSyncState();
        },
        loadFromLocalStorage() { storageModule.loadFromLocalStorage(this); },

        // Helpers
        getRemainingPercentage() {
            return Math.max(0, Math.min(100, (this.timer.timeLeft / ((this.config.durationMinutes || 45) * 60)) * 100));
        },
        getProgressColor() {
            const pct = this.getRemainingPercentage();
            if (pct > 50) return 'bg-emerald-500';
            if (pct > 20) return 'bg-amber-500';
            return 'bg-rose-600';
        },
        getTimerStatusText() { return this.timer.isRunning ? 'Đang chạy' : 'Tạm dừng'; }
    }));
});
