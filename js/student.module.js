export const studentModule = {
    openGradingModal(app, st) {
        app.targetStudentId = st.id;
        
        // Tạo bản sao độc lập (Clone) tránh thay đổi trực tiếp danh sách khi chưa bấm Lưu
        const currentScores = Array.isArray(st.scores) ? [...st.scores] : app.config.sections.map(() => 0);
        
        while (currentScores.length < app.config.sections.length) {
            currentScores.push(0);
        }

        app.activeStudent = {
            id: st.id,
            mssv: st.mssv,
            hoLot: st.hoLot,
            ten: st.ten,
            scores: currentScores,
            totalScore: st.totalScore || 0
        };
        
        app.showGradingModal = true;
    },

    calculateTotalScore(app, st) {
        if (!st || !st.scores) return;

        let total = 0;
        app.config.sections.forEach((sec, idx) => {
            let score = Number(st.scores[idx]) || 0;
            total += score;
        });

        // Chỉ tính điểm tổng trên bản sao tạm thời (KHÔNG gọi saveToLocalStorage ở đây)
        st.totalScore = Math.round(total * 100) / 100;
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
