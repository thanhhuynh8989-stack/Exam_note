export const studentModule = {
    openGradingModal(app, st) {
        if (!st.scores) st.scores = app.config.sections.map(() => 0);
        app.activeStudent = st;
        app.showGradingModal = true;
    },
    calculateTotalScore(app, st) {
        if (!st.scores) st.scores = app.config.sections.map(() => 0);
        st.totalScore = st.scores.reduce((sum, val) => sum + (Number(val) || 0), 0);
        app.saveToLocalStorage();
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