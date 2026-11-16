import { timerModule } from './js/timer.module.js';
import { pickerModule } from './js/picker.module.js';
import { studentModule } from './js/student.module.js';
import { configModule } from './js/config.module.js';
import { storageModule } from './js/storage.module.js';
import { printModule } from './js/print.module.js';
import { sessionModule } from './js/session.module.js';
import { syncBridgeModule } from './js/sync-bridge.module.js';
import { scoreImportModule } from './js/score-import.module.js';

function createExamAppState() {
    return {
        activeTab: 'timer',
        isLogExpanded: false,
        isScoreExpanded: false,
        isScoreFullscreen: false,
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
        _skipAutoDiffLog: false,
        _lastSavedStudents: [],
        _lastSavedConfigStr: '',
        _configLogDebounceTimer: null,

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

        timer: { timeLeft: 60 * 60, isRunning: false, intervalId: null, updatedAt: 0 },
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
            rawExamList: "Đề 1\nĐề 2",
            currentDisplay: "",
            isSpinning: false,
            targetStudentId: "",
            allowDuplicate: false
        },
        students: [],
        deletedStudentIds: [],
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
            this._lastSavedConfigStr = JSON.stringify(this.config || {});
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

        // --- Nhận diện thiết bị & Ghi nhật ký kiểm toán ---
        getDeviceActorLabel() {
            const devName = (this.syncState.deviceName || '').trim();
            if (this.syncState.role === 'host') {
                if (devName) return `${devName} (Chủ phòng)`;
                return this.config.examiner1 ? `Máy chính (${this.config.examiner1})` : 'Máy chính (Host)';
            }
            if (this.syncState.role === 'guest') {
                return devName || 'Giám thị phụ';
            }
            if (devName) return devName;
            return this.config.examiner1 ? `Giám thị (${this.config.examiner1})` : 'Thiết bị tại chỗ';
        },

        recordAuditLog(actionText, customDevice = null) {
            if (!actionText) return;
            const now = Date.now();
            this.logs.unshift({
                id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: now,
                time: new Date(now).toLocaleTimeString('vi-VN'),
                device: customDevice || this.getDeviceActorLabel(),
                text: actionText
            });
            if (this.logs.length > 500) {
                this.logs.length = 500;
            }
            this._skipAutoDiffLog = true;
            try {
                this.saveToLocalStorage();
            } finally {
                this._skipAutoDiffLog = false;
            }
        },

        detectAndLogLocalDiffs(prevStudents, nextStudents) {
            const prevMap = new Map((prevStudents || []).map(s => [s.id || s.mssv, s]));
            const nextMap = new Map((nextStudents || []).map(s => [s.id || s.mssv, s]));

            // Phát hiện nhập hàng loạt hoặc thêm mới
            const added = (nextStudents || []).filter(s => !prevMap.has(s.id || s.mssv));
            if (added.length > 1) {
                this.recordAuditLog(`Nhập danh sách thí sinh (+${added.length} SV, tổng ${nextStudents.length} SV)`);
                return;
            } else if (added.length === 1) {
                const st = added[0];
                this.recordAuditLog(`Thêm thí sinh: ${st.hoLot} ${st.ten} (${st.mssv})`);
                return;
            }

            // Phát hiện xóa
            const removed = (prevStudents || []).filter(s => !nextMap.has(s.id || s.mssv));
            if (removed.length > 0) {
                removed.forEach(st => {
                    const k = st.id || st.mssv;
                    if (k && !this.deletedStudentIds.includes(k)) this.deletedStudentIds.push(k);
                });
                if (removed.length === 1) {
                    this.recordAuditLog(`Xóa thí sinh: ${removed[0].hoLot} ${removed[0].ten} (${removed[0].mssv})`);
                } else {
                    this.recordAuditLog(`Xóa ${removed.length} thí sinh khỏi danh sách`);
                }
                return;
            }

            // Phát hiện thay đổi trạng thái từng thí sinh
            for (const st of (nextStudents || [])) {
                const old = prevMap.get(st.id || st.mssv);
                if (!old) continue;
                if (old.isPresent !== st.isPresent) {
                    this.recordAuditLog(`Điểm danh ${st.hoLot} ${st.ten} (${st.mssv}): ${st.isPresent ? 'Có mặt' : 'Vắng thi'}`);
                } else if (old.assignedExam !== st.assignedExam) {
                    this.recordAuditLog(`Cập nhật mã đề ${st.hoLot} ${st.ten} (${st.mssv}): ${st.assignedExam || 'Trống'}`);
                } else if (old.totalScore !== st.totalScore || JSON.stringify(old.scores || []) !== JSON.stringify(st.scores || [])) {
                    this.recordAuditLog(`Cập nhật điểm ${st.hoLot} ${st.ten} (${st.mssv}): ${st.totalScore ?? 0}đ`);
                }
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
            const id = Date.now() + Math.random();
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

        // --- Fullscreen of Score-List ---
        openScoreFullscreen() {
            this.isScoreFullscreen = true;
            if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(() => {});
            }
        },
        closeScoreFullscreen() {
            this.isScoreFullscreen = false;
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
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
            const presentCount = this.students.filter(s => s.isPresent !== false).length;
            if (this.picker.targetStudentId === 'ALL' && totalExams < presentCount && presentCount > 0) {
                this.picker.allowDuplicate = true;
                this.triggerToast(`Số lượng đề (${totalExams}) ít hơn số SV có mặt (${presentCount}). Đã tự động bật cho phép trùng đề!`, 'warning');
            }
        },

        // --- Student & Grading actions ---
        openGradingModal(st) {
            studentModule.openGradingModal(this, st);
            if (this.activeStudent) {
                if (!Array.isArray(this.activeStudent.scores)) {
                    this.activeStudent.scores = [];
                }
                while (this.activeStudent.scores.length < this.config.sections.length) {
                    this.activeStudent.scores.push(0);
                }
            }
        },
        isGradingScoreInvalid(idx) {
            if (!this.activeStudent || !Array.isArray(this.activeStudent.scores)) return false;
            const sec = this.config.sections[idx];
            if (!sec) return false;
            const val = Number(this.activeStudent.scores[idx]);
            return Number.isNaN(val) || val < 0 || val > Number(sec.maxScore);
        },
        
        calculateTotalScore(st) { studentModule.calculateTotalScore(this, st); },

        toggleAttendance(st) {
            const prevPresent = st.isPresent;
            studentModule.toggleAttendance(this, st);
            if (st.isPresent !== prevPresent) {
                this.recordAuditLog(`Điểm danh ${st.hoLot} ${st.ten} (${st.mssv}): ${st.isPresent ? 'Có mặt' : 'Vắng thi'}`);
            }
        },

        saveManualStudent() {
            const prevCount = this.students.length;
            const draft = { ...this.newStudent };
            studentModule.saveManualStudent(this);
            if (this.students.length > prevCount) {
                this.recordAuditLog(`Thêm thí sinh mới: ${draft.hoLot} ${draft.ten} (${draft.mssv})`);
            }
        },

        confirmDeleteStudent(st) {
            const stLabel = `${st.hoLot} ${st.ten} (${st.mssv})`;
            const stKey = st.id || st.mssv;
            studentModule.confirmDeleteStudent(this, st);
            if (this.confirmModal && typeof this.confirmModal.onConfirm === 'function') {
                const origConfirm = this.confirmModal.onConfirm;
                this.confirmModal.onConfirm = () => {
                    origConfirm();
                    if (stKey && !this.deletedStudentIds.includes(stKey)) {
                        this.deletedStudentIds.push(stKey);
                    }
                    this.recordAuditLog(`Xóa thí sinh: ${stLabel}`);
                };
            }
        },

        confirmClearAllStudents() {
            const total = this.students.length;
            if (total === 0) {
                this.triggerToast("Danh sách thí sinh hiện đang trống.", "info");
                return;
            }
            this.confirmModal = {
                show: true,
                title: "Xóa toàn bộ danh sách thí sinh",
                message: `Bạn có chắc chắn muốn xóa toàn bộ ${total} thí sinh hiện có (bao gồm điểm số và mã đề đã gán) không?`,
                onConfirm: () => {
                    this.students.forEach(s => {
                        const k = s.id || s.mssv;
                        if (k && !this.deletedStudentIds.includes(k)) {
                            this.deletedStudentIds.push(k);
                        }
                    });
                    this.students = [];
                    this._lastSavedStudents = [];
                    this.recordAuditLog(`Xóa toàn bộ danh sách thí sinh hiện có (${total} SV)`);
                    this.triggerToast(`Đã xóa toàn bộ ${total} thí sinh khỏi danh sách!`, "success");
                }
            };
        },

        handleSectionExcelScoreUpload(event, sectionIdx) {
            scoreImportModule.handleSectionExcelScoreUpload(this, event, sectionIdx);
        },

        hasGradingError() {
            if (!this.activeStudent || !this.activeStudent.scores || !this.config.sections) return false;
            return this.config.sections.some((sec, idx) => {
                const score = Number(this.activeStudent.scores[idx]) || 0;
                return score < 0 || score > Number(sec.maxScore);
            });
        },

        saveGradingModal() {
            if (this.hasGradingError()) {
                this.triggerToast("Điểm nhập phải nằm trong khoảng từ 0 đến điểm tối đa của phần thi!", "error");
                return;
            }
            const target = this.students.find(s => s.id === this.targetStudentId || s.id === (this.activeStudent && this.activeStudent.id));
            if (target) {
                target.scores = [...this.activeStudent.scores];
                target.totalScore = this.activeStudent.totalScore;
                target.updatedAt = Date.now();

                const breakdown = this.config.sections
                    .map((sec, idx) => `${sec.title || 'Phần ' + (idx + 1)}: ${target.scores[idx] ?? 0}`)
                    .join(', ');
                this.recordAuditLog(`Chấm điểm ${target.hoLot} ${target.ten} (${target.mssv}): [${breakdown}] → Tổng: ${target.totalScore}đ`);
                this.triggerToast("Đã lưu bảng điểm thành công!", "success");
            }
            this.showGradingModal = false;
            this.activeStudent = null;
        },

        // --- Config & Print actions ---
        getTotalPoints() { return configModule.getTotalPoints(this); },
        addSection() {
            configModule.addSection(this);
            this.recordAuditLog(`Thêm phần thi mới (Tổng ${this.config.sections.length} phần thi)`);
        },
        removeSection(idx) {
            const secName = this.config.sections[idx]?.title || `Phần ${idx + 1}`;
            configModule.removeSection(this, idx);
            this.recordAuditLog(`Xóa phần thi: ${secName}`);
        },
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
                    this.students.forEach(s => {
                        const k = s.id || s.mssv;
                        if (k && !this.deletedStudentIds.includes(k)) this.deletedStudentIds.push(k);
                    });
                    this.students = [];
                    this.logs = [];
                    this._lastSavedStudents = [];
                    this.sessionState.currentSessionId = null;
                    this.recordAuditLog("Xóa bản nháp danh sách thí sinh và làm mới ca thi");
                    this.triggerToast("Đã xóa bản nháp thành công!", "info");
                }
            };
        },

        saveToLocalStorage() {
            const prevStudents = this._lastSavedStudents || [];
            if (!this._isApplyingRemote) {
                this.students = syncBridgeModule.stampStudentUpdates(prevStudents, this.students);
                if (!this._skipAutoDiffLog) {
                    this.detectAndLogLocalDiffs(prevStudents, this.students);
                    const nextConfigStr = JSON.stringify(this.config || {});
                    if (this._lastSavedConfigStr && nextConfigStr !== this._lastSavedConfigStr) {
                        clearTimeout(this._configLogDebounceTimer);
                        this._configLogDebounceTimer = setTimeout(() => {
                            this.recordAuditLog(`Cập nhật thông tin cấu hình / thang điểm ca thi (Phòng ${this.config.roomName || '---'})`);
                        }, 1500);
                    }
                    this._lastSavedConfigStr = nextConfigStr;
                }
            } else {
                this._lastSavedConfigStr = JSON.stringify(this.config || {});
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
            this.recordAuditLog(`Cập nhật lịch thi: ${this.config.time}`);
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
    };
}

// Đăng ký component Alpine trước khi nạp plugin Collapse và Alpine Core (tránh lỗi race condition)
window.examApp = createExamAppState;
document.addEventListener('alpine:init', () => {
    window.Alpine.data('examApp', createExamAppState);
});

function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

loadExternalScript('https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.13.3/dist/cdn.min.js')
    .then(() => loadExternalScript('https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js'))
    .catch((err) => console.error('Lỗi khởi tạo Alpine.js:', err));
