import { timerModule } from './js/timer.module.js';
import { pickerModule } from './js/picker.module.js';
import { studentModule } from './js/student.module.js';
import { configModule } from './js/config.module.js';
import { storageModule } from './js/storage.module.js';
import { printModule } from './js/print.module.js';
import { sessionModule } from './js/session.module.js';
import { syncBridgeModule } from './js/sync-bridge.module.js';
import { scoreImportModule } from './js/score-import.module.js';

document.addEventListener('alpine:init', () => {
    Alpine.data('examApp', () => ({
        activeTab: 'timer',
        mobileMenuOpen: false,
        currentSystemTime: '',
        isZaloBrowser: false,
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
            status: 'disconnected', // 'disconnected' | 'connecting' | 'waiting_approval' | 'connected' | 'reconnecting'
            role: null,             // 'host' | 'guest' | null
            roomCode: '',
            inputCode: '',
            deviceName: '',
            authError: '',
            isScanningQr: false,
            pendingRequests: [],
            guestList: [],
            peerCount: 0
        },
        _syncManager: null,
        _isApplyingRemote: false,
        _lastSavedStudents: [],

        // Trạng thái Quản lý & Lưu trữ nhiều suất thi
        sessionState: {
            showModal: false,
            currentSessionId: null,
            newPassword: '',
            savedSessions: [],
            authPrompt: {
                show: false,
                action: '',
                session: null,
                inputPassword: '',
                errorMsg: ''
            }
        },

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
            examDateTimeISO: '', // Lưu dạng "2026-11-16T07:30"
            time: '',            // Lưu dạng "07 giờ 30 phút, ngày 16/11/2026"
            durationMinutes: 60,
            roomName: '116',
            facility: 'K7/25 Quang Trung',
            examiner1: 'HUỲNH NGỌC THÀNH',
            examiner2: '',
            sections: [
                { title: 'Tiêu bản tự chọn', maxScore: 5, note: 'Vẽ hình và trình bày', rounding: 'none', lastImportInfo: '' },
                { title: 'Bài thi chỉ định', maxScore: 5, note: 'Quan sát đặc điểm', rounding: 'none', lastImportInfo: '' }
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
            const ua = navigator.userAgent || '';
            if (/Zalo/i.test(ua)) {
                this.isZaloBrowser = true;
            }

            setInterval(() => { this.currentSystemTime = new Date().toLocaleTimeString('vi-VN'); }, 1000);
            this.loadFromLocalStorage();
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students || []));
            this.sessionState.savedSessions = sessionModule.loadAllSessions();

            if (!this.timer.timeLeft || this.timer.timeLeft <= 0) {
                this.timer.timeLeft = (this.config.durationMinutes || 45) * 60;
            }
            if (!this.isZaloBrowser) {
                syncBridgeModule.init(this);
            }

            if (!this.config.examDateTimeISO && this.config.time) {
                this.config.examDateTimeISO = this.parseVietnameseExamTimeToISO(this.config.time);
            }
            if (this.config.examDateTimeISO) {
                this.config.time = this.formatVietnameseExamTime(this.config.examDateTimeISO);
            }
        },

        copyCurrentUrl() {
            navigator.clipboard.writeText(window.location.href);
            this.triggerToast('Đã sao chép đường dẫn! Hãy dán vào Chrome hoặc Safari.', 'success');
        },

        // --- Điều khiển Đồng bộ P2P ---
        startLiveSyncHost() {
            if (this._syncManager) this._syncManager.startHost(null, false);
        },
        joinLiveSyncRoom() {
            if (!this._syncManager) return;
            this.syncState.authError = '';
            this._syncManager.joinRoom(this.syncState.inputCode, this.syncState.deviceName, false);
        },
        approveSyncGuest(deviceId) {
            if (this._syncManager) this._syncManager.approveGuest(deviceId);
        },
        rejectSyncGuest(deviceId) {
            if (this._syncManager) this._syncManager.rejectGuest(deviceId);
        },
        revokeSyncGuest(deviceId) {
            if (this._syncManager) this._syncManager.revokeGuest(deviceId);
        },
        async startQrScanner() {
            if (!this._syncManager) return;
            this.syncState.authError = '';
            this.syncState.isScanningQr = true;
            await this.$nextTick();

            const res = await this._syncManager.startQrScanner('p2p-qr-reader', (roomCode) => {
                this.syncState.inputCode = roomCode;
                this.syncState.isScanningQr = false;
                this.joinLiveSyncRoom();
            });

            if (!res.ok) {
                this.syncState.isScanningQr = false;
                const msg = res.reason === 'INSECURE_CONTEXT'
                    ? 'Trình duyệt chặn mở Camera trực tiếp do trang chưa dùng HTTPS. Hãy bấm nút "Chụp Ảnh Mã QR" bên cạnh!'
                    : 'Không mở được luồng Camera trực tiếp. Hãy dùng nút "Chụp Ảnh Mã QR" bên cạnh.';
                this.triggerToast(msg, 'warning');
            }
        },
        async handleQrImageCapture(event) {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file || !this._syncManager) return;
            this.syncState.authError = '';

            await this._syncManager.scanQrFromImageFile(file, (roomCode) => {
                this.syncState.inputCode = roomCode;
                this.joinLiveSyncRoom();
            });
        },
        async stopQrScanner() {
            if (this._syncManager) await this._syncManager.stopQrScanner();
            this.syncState.isScanningQr = false;
        },
        async closeSyncModal() {
            await this.stopQrScanner();
            this.syncState.showModal = false;
        },
        copySyncCode() {
            if (!this.syncState.roomCode) return;
            navigator.clipboard?.writeText(this.syncState.roomCode);
            this.triggerToast(`Đã sao chép mã phòng ${this.syncState.roomCode}`, 'success');
        },
        disconnectLiveSync() {
            this.syncState.isScanningQr = false;
            if (this._syncManager) this._syncManager.disconnect(true);
        },
        broadcastSyncState() {
            if (!this._isApplyingRemote && this._syncManager) {
                this._syncManager.broadcast(this._syncManager.getAppState());
            }
        },

        // --- Quản lý & Lưu trữ Suất thi ---
        openSessionModal() {
            this.sessionState.savedSessions = sessionModule.loadAllSessions();
            this.sessionState.authPrompt = { show: false, action: '', session: null, inputPassword: '', errorMsg: '' };
            this.sessionState.showModal = true;
        },
        saveCurrentSession(isUpdate = false) { sessionModule.saveSession(this, isUpdate); },
        triggerSessionAction(sessionItem, actionType) { sessionModule.requestSessionAction(this, sessionItem, actionType); },
        verifySessionPassword() { sessionModule.verifyAndExecuteAuth(this); },
        exportCurrentSessionJson() { sessionModule.exportSessionToJson(this, null); },
        exportSpecificSessionJson(sessionItem) { sessionModule.exportSessionToJson(this, sessionItem); },
        importSessionJson(event) { sessionModule.importSessionFromJson(this, event); },

        // --- Thông báo & Hộp thoại chung ---
        triggerToast(message, type = 'info') {
            const id = Date.now();
            this.toasts.push({ id, message, type, visible: true });
            setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 4000);
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

        // --- Timer actions ---
        toggleTimer() { timerModule.toggleTimer(this); this.broadcastSyncState(); },
        resetTimer() { timerModule.resetTimer(this); this.broadcastSyncState(); },
        adjustHours(amount) { timerModule.adjustHours(this, amount); this.broadcastSyncState(); },
        adjustMinutes(amount) { timerModule.adjustMinutes(this, amount); this.broadcastSyncState(); },
        addExtraMinutes(mins) { timerModule.addExtraMinutes(this, mins); this.broadcastSyncState(); },
        setQuickDuration(mins) { timerModule.setQuickDuration(this, mins); this.broadcastSyncState(); },
        formatTime(s) { return timerModule.formatTime(s); },
        addLog() { timerModule.addLog(this); this.broadcastSyncState(); },

        // --- Picker actions ---
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

        // --- Student & Grading actions ---
        openGradingModal(st) { studentModule.openGradingModal(this, st); },
        calculateTotalScore(st) { studentModule.calculateTotalScore(this, st); },
        toggleAttendance(st) { studentModule.toggleAttendance(this, st); },
        saveManualStudent() { studentModule.saveManualStudent(this); },
        confirmDeleteStudent(st) { studentModule.confirmDeleteStudent(this, st); },
        handleSectionExcelScoreUpload(event, sectionIdx) {
            scoreImportModule.handleSectionExcelScoreUpload(this, event, sectionIdx);
        },

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

        // --- Config & Print actions ---
        getTotalPoints() { return configModule.getTotalPoints(this); },
        addSection() { configModule.addSection(this); },
        removeSection(idx) { configModule.removeSection(this, idx); },
        printExamSheet() { printModule.printExamSheet(this); },

        // --- Storage & Excel actions ---
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
                    this.sessionState.currentSessionId = null;
                    this.broadcastSyncState();
                    this.triggerToast("Đã xóa bản nháp thành công!", "info");
                }
            };
        },
        saveToLocalStorage() {
            if (!this._isApplyingRemote) {
                this.students = syncBridgeModule.stampStudentUpdates(this._lastSavedStudents || [], this.students);
            }
            this._lastSavedStudents = JSON.parse(JSON.stringify(this.students));
            storageModule.saveToLocalStorage(this);
            this.broadcastSyncState();
        },
        loadFromLocalStorage() { storageModule.loadFromLocalStorage(this); },

        // --- Thời gian thi tiếng Việt & Helpers ---
        formatVietnameseExamTime(isoValue) {
            if (!isoValue || !isoValue.includes('T')) {
                return '.... giờ ..... phút, ngày ..../....../..........';
            }
            const [datePart, timePart] = isoValue.split('T');
            const [year, month, day] = datePart.split('-');
            const [hour, minute] = timePart.split(':');
            if (!year || !month || !day || !hour || !minute) {
                return '.... giờ ..... phút, ngày ..../....../..........';
            }
            return `${hour.padStart(2, '0')} giờ ${minute.padStart(2, '0')} phút, ngày ${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        },

        parseVietnameseExamTimeToISO(displayText) {
            if (!displayText) return '';
            const text = String(displayText).trim();

            const vnMatch = text.match(/(\d{1,2})\s*giờ\s*(\d{1,2})\s*phút,\s*ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
            if (vnMatch) {
                const [, hh, mm, dd, mo, yyyy] = vnMatch;
                return `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
            }

            const legacyMatch = text.match(/(\d{1,2})[h:](\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
            if (legacyMatch) {
                const [, hh, mm, dd, mo, yyyy] = legacyMatch;
                return `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
            }

            return '';
        },

        updateExamDateTime(isoValue) {
            this.config.examDateTimeISO = isoValue || '';
            this.config.time = this.formatVietnameseExamTime(isoValue);
            this.saveToLocalStorage();
        },

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
