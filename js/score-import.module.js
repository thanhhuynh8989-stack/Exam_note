export const scoreImportModule = {
    normalizeStudentId(val) {
        if (val === null || val === undefined) return '';
        let str = String(val).trim();
        str = str.replace(/^'+/, '');
        if (/^\d+\.0+$/.test(str)) {
            str = str.replace(/\.0+$/, '');
        }
        return str.replace(/\s+/g, '').toUpperCase();
    },

    handleSectionExcelScoreUpload(app, event, sectionIdx) {
        const file = event.target.files?.[0];
        if (!file) return;

        const section = app.config.sections[sectionIdx];
        if (!section) {
            event.target.value = '';
            return;
        }

        if (!app.students || app.students.length === 0) {
            app.triggerToast('Danh sách thí sinh đang trống! Vui lòng tải danh sách thí sinh trước.', 'warning');
            event.target.value = '';
            return;
        }

        if (!window.XLSX) {
            app.triggerToast('Không tìm thấy thư viện đọc bảng tính (SheetJS).', 'error');
            event.target.value = '';
            return;
        }

        const isCsv = file.name.toLowerCase().endsWith('.csv');
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const workbook = isCsv
                    ? window.XLSX.read(e.target.result, { type: 'string' })
                    : window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });

                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                if (rows.length <= 1) {
                    app.triggerToast('File bảng điểm không có dữ liệu thí sinh!', 'warning');
                    return;
                }

                const exactScoreMap = new Map();
                const numericFallbackMap = new Map();

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length < 9) continue;

                    const normMssv = this.normalizeStudentId(row[2]); // Cột C: Mã Sinh Viên
                    if (!normMssv || normMssv === 'MÃSINHVIÊN' || normMssv === 'MSSV') continue;

                    const rawScoreStr = String(row[8] ?? '').trim().replace(',', '.'); // Cột I: Điểm số
                    const rawScore = parseFloat(rawScoreStr);

                    if (!isNaN(rawScore)) {
                        exactScoreMap.set(normMssv, rawScore);
                        if (/^\d+$/.test(normMssv)) {
                            const strippedZeros = normMssv.replace(/^0+/, '') || '0';
                            numericFallbackMap.set(strippedZeros, rawScore);
                        }
                    }
                }

                if (exactScoreMap.size === 0) {
                    app.triggerToast('Không đọc được dữ liệu hợp lệ ở Cột C (Mã SV) và Cột I (Điểm số)!', 'error');
                    return;
                }

                const maxSecScore = Number(section.maxScore) || 0;
                const roundingMode = section.rounding || 'none';
                let matchedCount = 0;
                let absentWithScoreCount = 0;

                app.students.forEach((st) => {
                    if (!Array.isArray(st.scores)) {
                        st.scores = new Array(app.config.sections.length).fill(0);
                    }
                    while (st.scores.length < app.config.sections.length) {
                        st.scores.push(0);
                    }

                    const normStMssv = this.normalizeStudentId(st.mssv);
                    let baseScore10 = null;

                    if (exactScoreMap.has(normStMssv)) {
                        baseScore10 = exactScoreMap.get(normStMssv);
                    } else if (/^\d+$/.test(normStMssv)) {
                        const strippedStZeros = normStMssv.replace(/^0+/, '') || '0';
                        if (numericFallbackMap.has(strippedStZeros)) {
                            baseScore10 = numericFallbackMap.get(strippedStZeros);
                        }
                    }

                    if (baseScore10 !== null) {
                        let converted = (baseScore10 / 10) * maxSecScore;

                        if (roundingMode === '0.1') {
                            converted = Math.round(converted * 10) / 10;
                        } else if (roundingMode === '0.25') {
                            converted = Math.round(converted * 4) / 4;
                        } else if (roundingMode === '0.5') {
                            converted = Math.round(converted * 2) / 2;
                        } else {
                            converted = Math.round(converted * 100) / 100;
                        }

                        converted = Math.max(0, Math.min(maxSecScore, converted));
                        st.scores[sectionIdx] = converted;

                        const sum = app.config.sections.reduce((acc, _, idx) => acc + (Number(st.scores[idx]) || 0), 0);
                        st.totalScore = Math.round(sum * 100) / 100;
                        st.updatedAt = Date.now();

                        matchedCount++;
                        if (!st.isPresent) absentWithScoreCount++;
                    }
                });

                section.lastImportInfo = `Đã nạp ${matchedCount}/${app.students.length} SV (${file.name})`;

                app.logs.unshift({
                    time: new Date().toLocaleTimeString('vi-VN'),
                    text: `Nạp điểm [${section.title || 'Phần ' + (sectionIdx + 1)}]: khớp ${matchedCount}/${app.students.length} SV (thang ${maxSecScore}đ).`
                });

                app.saveToLocalStorage();

                if (matchedCount === 0) {
                    app.triggerToast('Không có Mã Sinh Viên nào khớp với danh sách phòng thi!', 'warning');
                } else if (absentWithScoreCount > 0) {
                    app.triggerToast(
                        `Đã cập nhật điểm cho ${matchedCount}/${app.students.length} SV (Lưu ý: có ${absentWithScoreCount} SV đang đánh dấu VẮNG nhưng có điểm!).`,
                        'warning'
                    );
                } else {
                    app.triggerToast(
                        `Đã cập nhật điểm "${section.title || 'Phần ' + (sectionIdx + 1)}" cho ${matchedCount}/${app.students.length} thí sinh!`,
                        'success'
                    );
                }
            } catch (err) {
                console.error('Lỗi đọc file bảng điểm:', err);
                app.triggerToast('Lỗi khi xử lý file bảng điểm Excel/CSV!', 'error');
            } finally {
                event.target.value = '';
            }
        };

        if (isCsv) {
            reader.readAsText(file, 'UTF-8');
        } else {
            reader.readAsArrayBuffer(file);
        }
    }
};
