export const studentModule = {
    calculateTotalScore(app, st) {
        if (!st || !st.scores) return;

        let total = 0;
        app.config.sections.forEach((sec, idx) => {
            let score = Number(st.scores[idx]) || 0;
            // Nếu muốn tự động chặn không cho vượt quá tối đa khi gõ (tùy chọn):
            // if (score > sec.maxScore) { score = sec.maxScore; st.scores[idx] = sec.maxScore; }
            total += score;
        });

        st.totalScore = Math.round(total * 100) / 100;
        app.saveToLocalStorage();
    },

    openGradingModal(app, st) {
        app.activeStudent = st;
        if (!app.activeStudent.scores) {
            app.activeStudent.scores = app.config.sections.map(() => 0);
        }
        app.showGradingModal = true;
    },
    
    toggleAttendance(app, st) {
        st.isPresent = !st.isPresent;
        app.saveToLocalStorage();
    },
    saveManualStudent(app) {
        if (!app.newStudent.mssv || !app.newStudent.ten) { 
            app.triggerToast("Nhập đủ MSSV và Tên!", "warning"); 
            return; 
        }
        app.students.push({
            id: 'ST_' + Date.now(),
            mssv: app.newStudent.mssv.trim(),
            hoLot: app.newStudent.hoLot.trim(),
            ten: app.newStudent.ten.trim(),
            className: app.newStudent.className.trim(),
            isPresent: true,
            assignedExam: '',
            scores: app.config.sections.map(() => 0),
            totalScore: 0
        });
        app.newStudent = { mssv: '', hoLot: '', ten: '', className: '' };
        app.showAddStudentModal = false;
        app.saveToLocalStorage();
        app.triggerToast("Đã thêm thí sinh thành công!", "success");
    },
    confirmDeleteStudent(app, st) {
        app.confirmModal = {
            show: true,
            title: "Xóa Thí Sinh",
            message: `Xóa thí sinh ${st.hoLot} ${st.ten}?`,
            onConfirm: () => {
                app.students = app.students.filter(s => s.id !== st.id);
                app.saveToLocalStorage();
                app.triggerToast("Đã xóa thí sinh!", "info");
            }
        };
    }
};
