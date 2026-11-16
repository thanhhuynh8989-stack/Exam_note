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

        const presentStudents = (app.students || []).filter(st => st.isPresent !== false);

        if (app.picker.targetStudentId === 'ALL' && presentStudents.length === 0) {
            app.triggerToast("Không có thí sinh nào đang có mặt để phát đề!", "warning");
            return;
        }

        if (app.picker.targetStudentId === 'ALL' && !app.picker.allowDuplicate && exams.length < presentStudents.length) {
            app.picker.allowDuplicate = true;
            app.triggerToast(`Số đề (${exams.length}) ít hơn số SV có mặt (${presentStudents.length}). Đã tự động bật cho phép trùng đề!`, 'warning');
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

                // TH1: GÁN CHO TOÀN BỘ SINH VIÊN CÓ MẶT
                if (app.picker.targetStudentId === 'ALL') {
                    if (app.picker.allowDuplicate) {
                        presentStudents.forEach(st => {
                            const randIdx = Math.floor(Math.random() * exams.length);
                            st.assignedExam = exams[randIdx];
                        });
                    } else {
                        const shuffledExams = [...exams].sort(() => Math.random() - 0.5);
                        presentStudents.forEach((st, idx) => {
                            st.assignedExam = shuffledExams[idx % shuffledExams.length];
                        });
                    }
                    app.picker.currentDisplay = "ĐÃ GÁN XONG";
                    if (app.recordAuditLog) {
                        app.recordAuditLog(`Bốc thăm phát đề ngẫu nhiên hàng loạt cho ${presentStudents.length} thí sinh có mặt`);
                    } else {
                        app.saveToLocalStorage();
                    }
                    app.triggerToast(`Đã gán ngẫu nhiên đề thi cho ${presentStudents.length} sinh viên có mặt!`, "success");

                // TH2: GÁN CHO 1 SINH VIÊN CỤ THỂ
                } else if (app.picker.targetStudentId) {
                    const selectedExam = app.picker.currentDisplay;
                    const target = app.students.find(s => s.id === app.picker.targetStudentId);
                    if (target) {
                        target.assignedExam = selectedExam;
                        if (app.recordAuditLog) {
                            app.recordAuditLog(`Bốc thăm gán mã đề "${selectedExam}" cho SV ${target.hoLot} ${target.ten} (${target.mssv})`);
                        } else {
                            app.saveToLocalStorage();
                        }
                        app.triggerToast(`Đã gán mã đề "${selectedExam}" cho sinh viên ${target.hoLot} ${target.ten}!`, "success");
                    }
                } else {
                    // TH3: BỐC TỰ DO KHÔNG GÁN
                    if (app.recordAuditLog) {
                        app.recordAuditLog(`Quay thử bốc thăm ngẫu nhiên ra: ${app.picker.currentDisplay}`);
                    }
                    app.triggerToast(`Đề được bốc: ${app.picker.currentDisplay}`, "info");
                }
            }
        }, 100);
    }
};
