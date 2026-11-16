// js/tips.module.js - Hướng dẫn sử dụng nhanh theo từng màn hình giao diện

const TAB_ALIASES = {
    timer: 'timer',
    clock: 'timer',
    picker: 'picker',
    random: 'picker',
    draw: 'picker',
    students: 'students',
    scores: 'students',
    grading: 'students',
    config: 'config',
    settings: 'config'
};

export const TIPS_DATA = {
    timer: {
        key: 'timer',
        tabTitle: 'Đồng hồ & Nhật ký ca thi',
        badge: 'Màn hình Thời gian',
        quickHint: 'Dùng nút +1p / +5p bù giờ khi có sự cố; bấm vào thẻ Nhật ký hoặc Danh sách điểm bên phải để mở rộng.',
        summary: 'Điều khiển thời gian làm bài, theo dõi nhật ký và trình chiếu bảng điểm theo thời gian thực.',
        items: [
            {
                title: 'Chỉnh nhanh & Bù giờ sự cố',
                desc: 'Chọn mốc thời gian chuẩn (15p–120p) trước khi thi, hoặc bấm +1p / +5p bù giờ khi gặp sự cố kỹ thuật.'
            },
            {
                title: 'Thẻ Nhật ký phòng thi thu gọn',
                desc: 'Bấm vào thẻ Nhật ký phòng thi ở cột phải để mở khung ghi nhận diễn biến (mất điện, đổi máy, SV ra ngoài).'
            },
            {
                title: 'Trình chiếu Danh sách điểm toàn màn hình',
                desc: 'Mở thẻ Danh sách điểm và bấm "Toàn màn hình" để chiếu điểm công khai kèm đồng hồ đếm ngược góc trái.'
            },
            {
                title: 'Đồng bộ đa thiết bị',
                desc: 'Khi bật Đồng bộ, thao tác chạy/tạm dừng đồng hồ từ Máy chính sẽ tự động cập nhật sang các máy phụ.'
            }
        ]
    },
    picker: {
        key: 'picker',
        tabTitle: 'Bốc thăm & Phân đề ngẫu nhiên',
        badge: 'Màn hình Bốc thăm',
        quickHint: 'Nhập mỗi mã đề trên 1 dòng; chọn đích danh 1 thí sinh hoặc chọn chia đề ngẫu nhiên cho cả phòng thi.',
        summary: 'Phân phối mã đề công khai, minh bạch cho từng thí sinh hoặc toàn bộ phòng thi.',
        items: [
            {
                title: 'Nhập danh sách mã đề',
                desc: 'Nhập mỗi mã đề trên một dòng riêng biệt (ví dụ: Đề 1, Đề 2...) ở khung cấu hình đề thi.'
            },
            {
                title: 'Bốc cho 1 thí sinh hoặc cả lớp',
                desc: 'Chọn đích danh 1 thí sinh có mặt để quay số, hoặc chọn "Tất cả thí sinh có mặt" để chia đề hàng loạt.'
            },
            {
                title: 'Chống trùng đề tự động',
                desc: 'Tắt "Cho phép trùng đề" nếu muốn mỗi thí sinh nhận một mã đề riêng cho tới khi hết kho đề.'
            },
            {
                title: 'Tự động lưu & đồng bộ',
                desc: 'Mã đề sau khi bốc sẽ tự động gắn vào thẻ của thí sinh và đồng bộ ngay sang các thiết bị giám sát.'
            }
        ]
    },
    students: {
        key: 'students',
        tabTitle: 'Thí sinh & Chấm điểm',
        badge: 'Màn hình Chấm điểm',
        quickHint: 'Bấm nhãn Có mặt/Vắng trên thẻ để điểm danh; bấm "Chấm điểm" để nhập điểm từng phần thi.',
        summary: 'Điểm danh, nhập điểm từng phần thi trên giao diện thẻ gọn gàng và xuất kết quả.',
        items: [
            {
                title: 'Điểm danh nhanh trên từng thẻ',
                desc: 'Bấm nút "Có mặt" / "Vắng thi" ở góc phải mỗi thẻ; thí sinh vắng sẽ tự động bỏ qua khi bốc thăm đề.'
            },
            {
                title: 'Chấm điểm từng phần thi',
                desc: 'Bấm "Chấm điểm" trên thẻ thí sinh để nhập điểm thành phần; hệ thống tự kiểm tra giới hạn điểm tối đa.'
            },
            {
                title: 'Chấm song song nhiều giám thị',
                desc: 'Hai giám thị có thể chấm 2 phần thi khác nhau của cùng 1 thí sinh trên 2 máy mà không bị ghi đè điểm.'
            },
            {
                title: 'Xuất bảng điểm & In phiếu A4',
                desc: 'Dùng thanh công cụ phía trên để xuất file Excel tổng hợp hoặc mở bản xem trước in danh sách chuẩn A4.'
            }
        ]
    },
    config: {
        key: 'config',
        tabTitle: 'Cấu hình ca thi & Danh sách',
        badge: 'Màn hình Cấu hình',
        quickHint: 'Tải lên danh sách SV từ Excel ở cột phải, thiết lập thang điểm từng phần và điền thông tin phiếu in.',
        summary: 'Quản lý danh sách thí sinh, thiết lập thông tin học phần và cơ cấu thang điểm.',
        items: [
            {
                title: 'Nhập & Quản lý danh sách thí sinh',
                desc: 'Tải file mẫu Excel, điền danh sách rồi bấm "Tải lên Danh sách thí sinh"; có thể xóa toàn bộ khi đổi ca thi.'
            },
            {
                title: 'Thông tin tiêu đề phiếu in',
                desc: 'Điền Tên học phần, Mã HP, Lớp, Phòng thi, Giám thị 1 & 2 để tự động hiển thị trên phiếu in A4 và file Excel.'
            },
            {
                title: 'Cơ cấu phần thi & Nạp điểm Excel',
                desc: 'Thêm/bớt các cột điểm, đặt điểm tối đa, quy tắc làm tròn hoặc nạp điểm trực tiếp từ file Excel (Cột C & I).'
            },
            {
                title: 'Lưu trữ nhiều suất thi',
                desc: 'Dùng nút "Suất thi" trên thanh tiêu đề để lưu riêng từng ca thi có đặt mật khẩu bảo vệ.'
            }
        ]
    }
};

export const tipsModule = {
    resolveTabKey(activeTab) {
        const raw = String(activeTab || 'timer').trim().toLowerCase();
        return TAB_ALIASES[raw] || 'timer';
    },

    getTipsForTab(activeTab) {
        const key = this.resolveTabKey(activeTab);
        return TIPS_DATA[key] || TIPS_DATA.timer;
    },

    getAllTipSections() {
        return Object.values(TIPS_DATA);
    }
};