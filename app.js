import { timerModule } from './js/timer.module.js';
import { pickerModule } from './js/picker.module.js';
import { studentModule } from './js/student.module.js';
import { configModule } from './js/config.module.js';
import { storageModule } from './js/storage.module.js';

window.examApp = function() {
    return {
        activeTab: 'timer',
        currentSystemTime: '',
        showAddStudentModal: false,
        showGradingModal: false,
        activeStudent: null,
        newLogText: '',
        toasts: [],
        confirmModal: { show: false, title: '', message: '', onConfirm: null },
        
        timer: { timeLeft: 60 * 60, isRunning: false, intervalId: null },
        config: {
            examTitle: 'KỲ THI KẾT THÚC HỌC PHẦN',
            subjectName: 'Thực Hành Sinh Học',
            roomName: 'P.302-A1',
            examTime: '07:30 - 18/11',
            durationMinutes: 45,
            sections: [
                { title: 'Tiêu bản tự chọn', maxScore: 5, note: 'Vẽ hình và trình bày' },
                { title: 'Bài thi chỉ định', maxScore: 5, note: 'Quan sát đặc điểm' }
            ]
        },
        picker: { rawExamList: "Đề 1\nĐề 2\nĐề 3\nĐề 4\nĐề 5\nĐề 6\nĐề 7\nĐề 8", currentDisplay: "", isSpinning: false, targetStudentId: "" },
        students: [],
        newStudent: { mssv: '', hoLot: '', ten: '', className: '' },
        logs: [],

        initApp() {
            setInterval(() => { this.currentSystemTime = new Date().toLocaleTimeString('vi-VN'); }, 1000);
            this.loadFromLocalStorage();
            if (!this.timer.timeLeft || this.timer.timeLeft <= 0) {
                this.timer.timeLeft = (this.config.durationMinutes || 45) * 60;
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

        // Timer actions
        toggleTimer() { timerModule.toggleTimer(this); },
        resetTimer() { timerModule.resetTimer(this); },
        addExtraMinutes(mins) { timerModule.addExtraMinutes(this, mins); },
        formatTime(s) { return timerModule.formatTime(s); },
        addLog() { timerModule.addLog(this); },

        // Picker actions
        getExamListArray() { return pickerModule.getExamListArray(this); },
        getAvailableExams() { return this.getExamListArray(); },
        startRandomDraw() { pickerModule.startRandomDraw(this); },

        // Student actions
        openGradingModal(st) { studentModule.openGradingModal(this, st); },
        calculateTotalScore(st) { studentModule.calculateTotalScore(this, st); },
        toggleAttendance(st) { studentModule.toggleAttendance(this, st); },
        saveManualStudent() { studentModule.saveManualStudent(this); },
        confirmDeleteStudent(st) { studentModule.confirmDeleteStudent(this, st); },

        // Config actions
        getTotalPoints() { return configModule.getTotalPoints(this); },
        addSection() { configModule.addSection(this); },
        removeSection(idx) { configModule.removeSection(this, idx); },

        // Storage & Excel actions
        downloadStudentTemplate() { storageModule.downloadStudentTemplate(); },
        handleStudentExcelUpload(e) { storageModule.handleStudentExcelUpload(this, e); },
        exportToExcelXLSX() { storageModule.exportToExcelXLSX(this); },
        exportToGoogleSheetsCompatibleFormat() { storageModule.exportToExcelXLSX(this); this.triggerToast("Đã xuất file tương thích Google Sheets!", "success"); },
        clearLocalStorageDraft() {
            this.confirmModal = {
                show: true,
                title: "Xóa Bản Nháp",
                message: "Bạn có chắc chắn muốn xóa toàn bộ bản nháp không?",
                onConfirm: () => {
                    localStorage.removeItem('EXAM_MONITOR_DATA_V5');
                    this.students = [];
                    this.logs = [];
                    this.triggerToast("Đã xóa bản nháp!", "info");
                }
            };
        },
        saveToLocalStorage() { storageModule.saveToLocalStorage(this); },
        loadFromLocalStorage() { storageModule.loadFromLocalStorage(this); },

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
    }
};