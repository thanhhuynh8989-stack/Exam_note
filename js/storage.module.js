export const storageModule = {
    downloadStudentTemplate() {
        const templateData = [
            { "Mã_Sinh_Viên": "2326521015", "Họ_Lót": "Trương Ngọc", "Tên": "Ánh", "Lớp": "BIO101 K3" },
            { "Mã_Sinh_Viên": "2326521030", "Họ_Lót": "Vũ Thị", "Tên": "Hằng", "Lớp": "BIO101 K3" }
        ];
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "DanhSachThiSinh");
        XLSX.writeFile(workbook, "Mau_Danh_Sach_Thi_Sinh_2_Cot.xlsx");
    },
    handleStudentExcelUpload(app, event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                let count = 0;
                jsonRows.forEach(row => {
                    const mssv = String(row["Mã_Sinh_Viên"] || row["MSSV"] || row["Mã Thí Sinh"] || row["SBD"] || "").trim();
                    const hoLot = String(row["Họ_Lót"] || row["Họ Lót"] || row["HoLot"] || "").trim();
                    const ten = String(row["Tên"] || row["Ten"] || "").trim();
                    const className = String(row["Lớp"] || row["Class"] || "").trim();

                    if (mssv && ten) {
                        app.students.push({
                            id: 'ST_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                            mssv: mssv,
                            hoLot: hoLot,
                            ten: ten,
                            className: className,
                            isPresent: true,
                            assignedExam: '',
                            scores: app.config.sections.map(() => 0),
                            totalScore: 0
                        });
                        count++;
                    }
                });

                app.saveToLocalStorage();
                app.triggerToast(`Đã nhập thành công ${count} thí sinh!`, "success");
            } catch (err) {
                app.triggerToast("Lỗi đọc file Excel!", "error");
            }
            event.target.value = '';
        };
        reader.readAsArrayBuffer(file);
    },
    exportToExcelXLSX(app) {
        if (app.students.length === 0) { app.triggerToast("Chưa có thí sinh để xuất Excel!", "warning"); return; }
        let data = [];
        app.students.forEach((st, idx) => {
            let row = {
                "STT": idx + 1,
                "Mã_Sinh_Viên": st.mssv,
                "Họ_Lót": st.hoLot,
                "Tên": st.ten,
                "Lớp": st.className || "",
                "Điểm Danh": st.isPresent ? "Có mặt" : "Vắng mặt",
                "Đề Thi": st.assignedExam || ""
            };
            app.config.sections.forEach((sec, sIdx) => {
                row[sec.title] = (st.scores && st.scores[sIdx] !== undefined) ? st.scores[sIdx] : 0;
            });
            row["Tổng Điểm"] = st.totalScore || 0;
            data.push(row);
        });
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "KetQuaThi");
        XLSX.writeFile(workbook, `BangDiem_${app.config.roomName || 'PhongThi'}.xlsx`);
        app.triggerToast("Đã tải file Excel kết quả thành công!", "success");
    },
    saveToLocalStorage(app) {
        localStorage.setItem('EXAM_MONITOR_DATA_V5', JSON.stringify({
            config: app.config, picker: app.picker, students: app.students, logs: app.logs
        }));
    },
    loadFromLocalStorage(app) {
        const raw = localStorage.getItem('EXAM_MONITOR_DATA_V5');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.config) app.config = Object.assign(app.config, parsed.config);
                if (parsed.picker) app.picker = Object.assign(app.picker, parsed.picker);
                if (parsed.students) app.students = parsed.students;
                if (parsed.logs) app.logs = parsed.logs;
            } catch(e) {}
        }
    }
};