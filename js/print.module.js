export const printModule = {
    // Hàm kích hoạt chế độ xem trước và in ấn
    printExamSheet(app) {
        // Tạo một cửa sổ/tab mới để làm giao diện Preview A4
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            app.triggerToast("Trình duyệt đang chặn cửa sổ pop-up. Hãy cho phép để xem trước bản in!", "error");
            return;
        }

        // Lấy dữ liệu cấu hình từ app
        const cfg = app.config || {};
        const students = app.students || [];

        // Tính tổng điểm tối đa từ các phần thi
        const totalMaxScore = cfg.sections ? cfg.sections.reduce((sum, s) => sum + (Number(s.maxScore) || 0), 0) : 10;

        // Render danh sách sinh viên ra các dòng của bảng
        let studentRowsHTML = '';
        if (students.length === 0) {
            studentRowsHTML = `<tr><td colspan="9" style="text-align: center; padding: 20px; color: #666;">Chưa có dữ liệu thí sinh trong phòng thi này.</td></tr>`;
        } else {
            students.forEach((st, idx) => {
                studentRowsHTML += `
                    <tr>
                        <td style="text-align: center;">${idx + 1}</td>
                        <td style="font-family: monospace; font-weight: bold; text-align: center;">${st.mssv || ''}</td>
                        <td>${st.hoLot || ''}</td>
                        <td style="font-weight: 500;">${st.ten || ''}</td>
                        <td style="text-align: center;">${st.className || cfg.roomName || ''}</td>
                        <td style="text-align: center;"></td> <!-- Số tờ -->
                        <td style="text-align: center;"></td> <!-- Ký tên -->
                        <td style="text-align: center;"></td> <!-- Điểm -->
                        <td style="text-align: center;"></td> <!-- Ghi chú -->
                    </tr>
                `;
            });
        }

        // Xây dựng mã HTML chuẩn biểu mẫu hành chính A4
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="vi">
            <head>
                <meta charset="UTF-8">
                <title>In Danh Sách Dự Thi - ${cfg.subjectName || 'Môn học'}</title>
                <style>
                    /* Khổ giấy A4 dọc và định dạng trang in */
                    @page {
                        size: A4 portrait;
                        margin: 10mm 15mm 10mm 15mm;
                    }
                    * {
                        box-sizing: border-box;
                        -webkit-print-color-adjust: exact;
                    }
                    body {
                        font-family: 'Times New Roman', Times, serif, Arial, sans-serif;
                        font-size: 11pt;
                        color: #000;
                        line-height: 1.25;
                        margin: 0;
                        padding: 0;
                        background: #525659; /* Màu nền xám bên ngoài khung A4 khi xem trước */
                    }

                    /* Khung chứa trang giấy A4 trên màn hình Preview */
                    .page-container {
                        width: 210mm;
                        min-height: 297mm;
                        padding: 15mm;
                        margin: 10mm auto;
                        background: #ffffff;
                        box-shadow: 0 0 15px rgba(0,0,0,0.3);
                        position: relative;
                    }

                    /* Khi bấm lệnh in từ trình duyệt, ẩn nền xám, bỏ box-shadow */
                    @media print {
                        body {
                            background: none;
                        }
                        .page-container {
                            width: 100%;
                            margin: 0;
                            padding: 0;
                            box-shadow: none;
                        }
                        .no-print {
                            display: none !important;
                        }
                    }

                    /* Thanh công cụ nổi trên trang Preview (chỉ hiển thị khi xem trước, ẩn khi in) */
                    .preview-toolbar {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: #1e293b;
                        color: #fff;
                        padding: 12px 24px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        z-index: 1000;
                        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
                    }
                    .preview-toolbar h3 {
                        margin: 0;
                        font-size: 16px;
                        font-family: Arial, sans-serif;
                    }
                    .btn-action {
                        background: #2563eb;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 6px;
                        font-weight: bold;
                        cursor: pointer;
                        font-family: Arial, sans-serif;
                        font-size: 14px;
                        margin-left: 10px;
                    }
                    .btn-action:hover { background: #1d4ed8; }
                    .btn-close { background: #64748b; }
                    .btn-close:hover { background: #475569; }

                    /* Khoảng đệm đầu trang do có thanh toolbar Preview */
                    .preview-spacer {
                        height: 50px;
                    }

                    /* Header biểu mẫu */
                    .header-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 10px;
                    }
                    .header-table td {
                        vertical-align: top;
                        padding: 0;
                    }
                    .school-name {
                        font-size: 11pt;
                        font-weight: bold;
                        text-align: center;
                        text-transform: uppercase;
                    }
                    .doc-title {
                        font-size: 14pt;
                        font-weight: bold;
                        text-align: center;
                        text-transform: uppercase;
                        margin-top: 5px;
                        margin-bottom: 5px;
                    }
                    .exam-meta {
                        font-size: 11pt;
                        text-align: center;
                        margin-bottom: 8px;
                    }
                    .exam-details {
                        font-size: 11pt;
                        margin-bottom: 10px;
                        border: 1px solid #000;
                        padding: 6px 10px;
                    }
                    .exam-details table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    .exam-details td {
                        padding: 2px 4px;
                    }

                    /* Bảng danh sách sinh viên */
                    .student-table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-bottom: 15px;
                    }
                    .student-table th, .student-table td {
                        border: 1px solid #000;
                        padding: 5px 4px;
                        font-size: 10pt;
                    }
                    .student-table th {
                        background-color: #f2f2f2 !important;
                        text-align: center;
                        font-weight: bold;
                    }

                    /* Khu vực tổng kết và chữ ký */
                    .footer-section {
                        font-size: 11pt;
                        margin-top: 10px;
                    }
                    .summary-line {
                        margin-bottom: 15px;
                        font-weight: bold;
                    }
                    .signature-table {
                        width: 100%;
                        border-collapse: collapse;
                        text-align: center;
                        margin-top: 10px;
                    }
                    .signature-table td {
                        vertical-align: top;
                        width: 33.33%;
                        padding: 5px;
                    }
                    .signature-title {
                        font-weight: bold;
                        text-transform: uppercase;
                        font-size: 10pt;
                    }
                    .signature-subtitle {
                        font-style: italic;
                        font-size: 9pt;
                        margin-bottom: 60px; /* Khoảng trống để ký tên */
                    }
                    .examiner-name {
                        font-weight: bold;
                        text-transform: uppercase;
                    }
                </style>
            </head>
            <body>

                <!-- Thanh công cụ Xem trước (Ẩn khi in PDF) -->
                <div class="preview-toolbar no-print">
                    <h3>📄 Xem Trước Bản In A4 (Đứng)</h3>
                    <div>
                        <button class="btn-action" onclick="window.print()">🖨️ In / Tải về PDF</button>
                        <button class="btn-action btn-close" onclick="window.close()">Đóng cửa sổ</button>
                    </div>
                </div>
                <div class="preview-spacer no-print"></div>

                <!-- Khung trang giấy A4 -->
                <div class="page-container">
                    
                    <!-- Phần đầu biểu mẫu -->
                    <table class="header-table">
                        <tr>
                            <td style="width: 40%;">
                                <div style="font-size: 10pt; text-align: center;">BỘ GIÁO DỤC & ĐÀO TẠO</div>
                                <div class="school-name">ĐẠI HỌC DUY TÂN</div>
                            </td>
                            <td style="width: 60%;">
                                <div style="font-size: 10pt; text-align: right; font-weight: bold;">
                                    NH: ${cfg.academicYear || '2026-2027'} | HKI: ${cfg.semester || '1'} | Lần thi: ${cfg.examAttempt || '1'}
                                </div>
                            </td>
                        </tr>
                    </table>

                    <div class="doc-title">DANH SÁCH SINH VIÊN DỰ THI KTHP</div>
                    <div class="exam-meta">
                        <b>MÔN :</b> ${cfg.subjectName || '---'} &nbsp;&nbsp;|&nbsp;&nbsp; <b>MÃ MÔN :</b> ${cfg.subjectCode || 'BIO101'}
                    </div>

                    <div class="exam-details">
                        <table>
                            <tr>
                                <td style="width: 35%;"><b>Thời gian:</b> ${cfg.examTime || '07h00 - 08/11/2026'}</td>
                                <td style="width: 25%;"><b>Phòng:</b> ${cfg.roomName || '116'}</td>
                                <td style="width: 40%;"><b>Cơ sở:</b> ${cfg.facility || 'K7/25 Quang Trung'}</td>
                            </tr>
                            <tr>
                                <td><b>Khối lớp:</b> ${cfg.classGroup || cfg.subjectCode || 'BIO101'}</td>
                                <td><b>Lớp:</b> ${cfg.subClass || 'C1'}</td>
                                <td><b>Số TC:</b> ${cfg.credits || '1'}</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Bảng danh sách sinh viên -->
                    <table class="student-table">
                        <thead>
                            <tr>
                                <th style="width: 35px;">STT</th>
                                <th style="width: 95px;">MÃ SV</th>
                                <th>HỌ LÓT</th>
                                <th style="width: 85px;">TÊN</th>
                                <th style="width: 75px;">LỚP MÔN</th>
                                <th style="width: 45px;">SỐ TỜ</th>
                                <th style="width: 90px;">KÝ TÊN</th>
                                <th style="width: 65px;">ĐIỂM (${totalMaxScore}đ)</th>
                                <th style="width: 75px;">GHI CHÚ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${studentRowsHTML}
                        </tbody>
                    </table>

                    <!-- Phần tổng kết và chữ ký -->
                    <div class="footer-section">
                        <div class="summary-line">
                            Số SV vắng: ........... &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Đình chỉ: ........... &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Tổng số bài: ........... &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Tổng số tờ: ...........
                        </div>

                        <table class="signature-table">
                            <tr>
                                <td>
                                    <div class="signature-title">Giám Khảo 1</div>
                                    <div class="signature-subtitle">(Ký và ghi rõ họ tên)</div>
                                    <div class="examiner-name">${cfg.examiner1 || ''}</div>
                                </td>
                                <td>
                                    <div class="signature-title">Giám Khảo 2</div>
                                    <div class="signature-subtitle">(Ký và ghi rõ họ tên)</div>
                                    <div class="examiner-name">${cfg.examiner2 || ''}</div>
                                </td>
                                <td>
                                    <div class="signature-title">Trung Tâm Khảo Thí</div>
                                    <div class="signature-subtitle">(Ký và đóng dấu)</div>
                                </td>
                            </tr>
                        </table>
                    </div>

                </div>

            </body>
            </html>
        `;

        // Nạp nội dung vào cửa sổ mới và mở hộp thoại Print
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    }
};