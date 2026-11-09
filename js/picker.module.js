export const pickerModule = {
    getExamListArray(app) {
        if (!app.picker || !app.picker.rawExamList) return [];
        return app.picker.rawExamList
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    },

    startRandomDraw(app) {
        const exams = this.getExamListArray(app);
        if (exams.length === 0) {
            app.triggerToast("Chưa có danh sách mã đề thi nào!", "warning");
            return;
        }

        if (app.picker.targetStudentId === 'ALL' && app.students.length === 0) {
            app.triggerToast("Danh sách sinh viên đang trống!", "warning");
            return;
        }

        // Tự động bật trùng đề nếu số đề ít hơn số SV
        if (app.picker.targetStudentId === 'ALL' && !app.picker.allowDuplicate && exams.length < app.students.length) {
            app.picker.allowDuplicate = true;
            app.triggerToast(`Số đề (${exams.length}) ít hơn số SV (${app.students.length}). Đã tự động bật cho phép trùng đề!`, 'warning');
        }

        app.picker.isSpinning = true;
        let counter = 0;
        const totalSpins = 20;

        const spinInterval = setInterval(() => {
            const randomIndex = Math.floor(Math.random() * exams.length);
            app.picker.currentDisplay = exams[randomIndex];
            counter++;

            if (counter >= totalSpins) {
                clearInterval(spinInterval);
                app.picker.isSpinning = false;

                // TH1: GÁN CHO TOÀN BỘ SINH VIÊN
                if (app.picker.targetStudentId === 'ALL') {
                    if (app.picker.allowDuplicate) {
                        // Cho phép trùng đề: Chọn ngẫu nhiên độc lập từng đề cho mỗi SV
                        app.students.forEach(st => {
                            const randIdx = Math.floor(Math.random() * exams.length);
                            st.assignedExam = exams[randIdx];
                        });
                    } else {
                        // Không trùng đề: Trộn ngẫu nhiên danh sách đề và gán
                        const shuffledExams = [...exams].sort(() => Math.random() - 0.5);
                        app.students.forEach((st, idx) => {
                            st.assignedExam = shuffledExams[idx % shuffledExams.length];
                        });
                    }
                    app.picker.currentDisplay = "ĐÃ GÁN XONG";
                    app.saveToLocalStorage();
                    app.triggerToast(`Đã gán ngẫu nhiên đề thi cho toàn bộ ${app.students.length} sinh viên!`, "success");
                
                // TH2: GÁN CHO 1 SINH VIÊN CỤ THỂ
                } else if (app.picker.targetStudentId) {
                    const selectedExam = app.picker.currentDisplay;
                    const target = app.students.find(s => s.id === app.picker.targetStudentId);
                    if (target) {
                        target.assignedExam = selectedExam;
                        app.saveToLocalStorage();
                        app.triggerToast(`Đã gán mã đề "${selectedExam}" cho sinh viên ${target.hoLot} ${target.ten}!`, "success");
                    }
                } else {
                    // TH3: BỐC TỰ DO KHÔNG GÁN
                    app.triggerToast(`Đề được bốc: ${app.picker.currentDisplay}`, "info");
                }
            }
        }, 100);
    }
};
