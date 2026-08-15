[English](README.md) · ***Tiếng Việt***

# colab-handbook

Bộ quy ước và công cụ nhỏ để vận hành nhiều repo — nhiều phiên code song song,
người thật lẫn AI agent — mà không giẫm chân nhau.

**Nếu bạn là AI agent, dừng ở đây và đọc [`CLAUDE.md`](CLAUDE.md).**
File này dành cho con người.

*(Tài liệu chuẩn tắc — [`CONVENTIONS.md`](CONVENTIONS.md) — viết bằng tiếng Anh
để agent và tool đọc được. Bản này là cửa vào tiếng Việt cho anh em dev; bản
tiếng Anh nằm ở [`README.md`](README.md). Cả hai chỉ là cửa vào, không phải
tài liệu chuẩn tắc — khi hai bản nói khác nhau thì **cả hai đều sai** cho tới
khi khớp lại với `CONVENTIONS.md`.)*

## Đây là cái gì

Một cuốn **handbook, không phải framework**. Nó quyết định **kết quả** — code
merge vào đâu, release là gì, báo "tôi đang làm việc này" bằng cách nào — và cố
tình để **cách hiện thực** (phiên bản Node, test runner, file CI của bạn) cho
từng repo tự quyết.

Mọi thứ trong đây được chưng cất từ việc vận hành ~25 repo thật, trong đó có
nhiều app production được bảo trì gần như hoàn toàn bởi AI agent chạy song song
trên nhiều worktree. Mục anti-pattern không phải lý thuyết: từng mục là chuyện
đã xảy ra thật, kèm sẹo để chứng minh.

### Nó giải quyết vấn đề gì

Một người, một repo thì chẳng cần gì trong đây cả. Quy ước nằm trong đầu người
đó, và trong đầu là chỗ duy nhất nó cần nằm.

Cách đó hết hiệu lực đâu đó quanh cái repo thứ ba, và sụp hẳn khi các phiên bắt
đầu chạy **song song** — vài phiên một lúc, trên nhiều máy khác nhau, có những
phiên là agent và chúng sẽ không nghĩ ra chuyện phải hỏi. Lúc đó mọi giả định
không viết ra đều thành một cách để mất việc:

- hai phiên cùng claim một issue, vì chẳng bên nào thấy được bên kia đã bắt đầu;
- một nhánh feature bị bỏ quên trên chính working tree mà dev server đang đọc,
  thế là app đang chạy lặng lẽ phục vụ code chưa merge;
- code đã merge mà issue vẫn mở, nên người sau làm lại từ đầu;
- tài liệu của một repo mô tả một repo không còn tồn tại — thứ này tệ hơn là
  không có tài liệu, vì kiểu gì cũng có người tin theo mà làm.

Không cái nào trong đó là vấn đề khó. Chúng đều là **cùng một** vấn đề: **những
sự thật về một repo lại nằm trong trí nhớ của ai đó thay vì nằm trong repo.**

### Thực chất nó làm gì

Nó bắt mỗi repo tự trả lời một nhúm câu hỏi về chính mình, **một lần**, vào một
file mà mọi phiên đều đọc trước khi động vào bất cứ thứ gì — hôm nay đã có
production chưa, còn ai khác làm ở đây, merge sai thì hỏng cái gì, mỗi lúc chạy
bao nhiêu đầu việc, và code đi tới chỗ nó chạy bằng đường nào.

Mọi thứ còn lại suy ra từ mấy câu trả lời đó: merge vào nhánh nào, ở repo này
release nghĩa là gì, có bắt buộc phải có nhánh không, một phiên phải ghi lại
bao nhiêu trước khi dừng. Phiên làm việc không phải đoán, và hai repo không bao
giờ hiểu khác nhau về cùng một từ.

Phần còn lại của repo sinh ra để phục vụ điều đó: một CLI làm giúp phần cơ học,
một audit báo chỗ nào thực tế đã trôi khỏi thứ repo tự khai, và các luồng phiên
làm việc mang đi được để phiên code ở đâu cũng mở ra và đóng lại giống nhau.

### Nó không phải cái gì

- **Không phải một service.** Không có gì ở đây là dependency và không có gì gửi
  dữ liệu về. Bạn copy cái nào thấy dùng được rồi sở hữu bản copy đó — fork,
  sửa, xoá bớt nửa cũng được. Giấy phép sinh ra để làm việc đó.
- **Không phải hệ thống CI, cũng không có ý kiến gì về stack của bạn.** Ngôn
  ngữ, test runner, pipeline — của bạn cả. Handbook chỉ yêu cầu pipeline cho ra
  hai kết quả, và không bao giờ nói phải làm bằng cách nào.
- **Không phải lớp ép buộc**, trừ đúng một ngoại lệ cố ý. Chuyện tuân thủ chỉ là
  cảnh báo, vì sai một quy ước thì tốn một cuộc trao đổi. Chuyện phát hành ra
  ngoài thì chặn, vì history không thu hồi lại được một khi đã có người clone.
- **Không phải thang đo độ trưởng thành.** Không câu trả lời nào ở đây xếp repo
  này trên repo kia. Một repo chưa có production không phải repo tệ hơn; nó là
  repo có ít cổng hơn.

Nếu bạn làm một repo một mình, đọc mục anti-pattern rồi lấy cái nào thấy dùng
được. Còn nếu bạn chạy nhiều repo — hoặc bạn làm việc cùng những agent chưa
từng gặp người đặt ra luật — thì nhiều khả năng nó hoàn vốn nhanh hơn cả thời
gian bạn bỏ ra để đọc.

## Năm câu hỏi

Adopt handbook này nghĩa là trả lời năm câu hỏi về repo của bạn, một lần, ghi
vào `.github/project.yml` — để không phiên nào phải đoán, và không hai repo
nào hiểu khác nhau về cùng một từ:

1. **Hôm nay đã có đích deploy chưa** — và đến đó bằng đường nào: một tag gác
   cổng production, chính cú promote là deploy, một người chạy runbook bằng
   tay, hay chưa có gì sống cả?
2. **Còn ai khác làm ở repo này** — một mình, một team, hay có cả người
   ngoài?
3. **Merge nhầm thì cái gì hỏng** — không gì cả, chỉ những người đang có mặt
   ở đây, người dùng qua lần promote kế tiếp, hay người dùng/người adopt qua
   một artifact đã phát hành?
4. **Một việc tại một thời điểm, hay nhiều việc chạy song song?**
5. **Code đi tới chỗ nó chạy bằng đường nào** — một workflow CI, một git
   hook, một quy trình tay có ghi lại, một checkout đang sống sẵn, một
   artifact phát hành, dữ liệu của hệ thống khác, hay chưa có đường nào cả?

Trả lời xong năm câu này là quyết định luôn mọi thứ còn lại: merge vào nhánh
nào, release nghĩa là gì, Issue tường thuật nhiều hay ít, cần gì để undo một
merge, có bắt buộc phải có branch hay không. Không câu nào bị hỏi hai lần, và
không câu nào hỏi cái mà repo đã tự nói sẵn rồi — nhánh mặc định, toolchain,
port của nó.

Issue được **claim** bằng assignee + label `in-progress` trước khi bắt tay vào
làm, nên các phiên song song không bao giờ đụng nhau trên cùng một việc.

Toàn bộ luật — mỗi câu trả lời quy về đâu, và vì sao:
[`CONVENTIONS.md`](CONVENTIONS.md). Đọc mất ~15 phút và là file **chuẩn tắc
duy nhất** — mọi thứ còn lại trong repo chỉ phục vụ nó.

## Cấu trúc repo

| Đường dẫn | Là gì |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | Luật. Chuẩn tắc, nguồn sự thật duy nhất (EN). |
| [`CLAUDE.md`](CLAUDE.md) | Cửa vào cho AI agent — bản chưng cất vận hành (EN). |
| [`project.schema.md`](project.schema.md) | Tham chiếu field của `.github/project.yml`. |
| [`templates/`](templates/) | Điểm khởi đầu **copy-về-là-của-bạn**: CI, release, git hook (một bản quét secret và một bản quét danh tính), và block `CLAUDE.md` cho repo adopt. **Không có gì được gọi từ xa** — copy, sửa, sở hữu. Là template chứ không phải scaffold, vì scaffold chỉ tới được những repo tạo ra sau khi nó ra đời. |
| [`tools/`](tools/) | `colab` — một CLI nhỏ (tùy chọn): adopt một repo, claim issue, cấp port, quản lý worktree, và merge nhánh đã xong vào trunk khi repo cho phép. State JSON, không dependency. Tham chiếu đầy đủ các lệnh: [`tools/README.md`](tools/README.md). |
| [`audit/`](audit/) | Trình kiểm tra conformance từ bên ngoài. Đọc mọi repo của bạn — mọi owner, kể cả repo local-only — và báo drift trong một lần chạy. Chỉ cảnh báo, không bao giờ chặn. Thêm `--identity` thì quét cả description và topic của repo public — thứ mà không git hook nào nhìn thấy được. Ý nghĩa từng check: [`audit/README.md`](audit/README.md). |
| [`skills/`](skills/) | Flow phiên làm việc portable: `code-triage` (chọn việc tiếp theo, gắn cờ việc khó cần plan) → `code-start` (mở phiên; chạy `code-plan` khi có cờ) → `code-wrap` (chưng cất + gate + bàn giao) → `code-ship` (chấm điểm + merge, cần người xác nhận), cộng `code-sweep` (dọn sạch mọi việc ĐÃ XONG trong một repo — hoặc chỉ một nhóm issue hay một phiên được chỉ định — chạy `code-wrap`+`code-ship` từng cái) và `handbook-sync` (kéo MỘT repo lên bản handbook mới nhất, chạy từ trong repo đó). [`install.sh`](install.sh) cài chúng thành skill Claude Code — xem mục *Cài đặt máy* ngay dưới. |
| [`install.sh`](install.sh) | Cài đặt cho **máy của bạn**: skills, CLI `colab`, hook pre-commit, danh sách repo cho audit. Idempotent, và `--dry` cho xem trước mọi thứ. |

## Cài đặt máy

Làm một lần cho mỗi máy, trước khi adopt handbook vào repo nào.

**Cần có sẵn:** `git`; `node` ≥ 18 (`.nvmrc` ghim 22 — đúng bản CI ở đây chạy);
`gh` và phải **đăng nhập rồi** (`gh auth login`) — claim issue, các skill và
phần audit repo remote đều vô dụng nếu thiếu, mà lỗi thì mãi về sau mới hiện ra
dưới dạng khó hiểu; `gitleaks` chỉ cần nếu bạn muốn bật hook pre-commit.
`install.sh` kiểm tra hết những thứ này và báo cái nào thiếu *trước khi* đụng
vào bất cứ gì.

**1. Clone vào chỗ ở lâu dài** — để chung với đống code của bạn, đừng để trong
thư mục tạm.

```sh
git clone https://github.com/godx-jp/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook
```

**Bản clone này là hạ tầng, không phải file tải về xem cho biết.** Các skill
được cài bằng symlink trỏ *thẳng vào working tree này*: xoá clone đi là mọi
phiên trên máy mất skill, và repo đang checkout nhánh nào thì mọi phiên dùng
đúng bản skill của nhánh đó. Nên khi không trực tiếp sửa handbook, hãy để nó ở
`main`. `install.sh` sẽ cảnh báo nếu thấy mình đang nằm trong `/tmp`,
`~/Downloads` hay `~/Desktop`.

**2. Cài.**

```sh
./install.sh --all --dry   # xem trước sẽ làm gì; không thay đổi gì cả
./install.sh --all         # skills + CLI colab + hook pre-commit + danh sách repo
```

`--all` là lựa chọn nên dùng cho lần chạy đầu. Mọi thứ nó làm đều là symlink
hoặc copy, chạy lại bao nhiêu lần cũng được, và không bao giờ ghi đè thứ nó
không tạo ra — skill của riêng bạn, hay `~/.colab/repos.txt` đã có sẵn, đều được
giữ nguyên kèm một dòng cảnh báo. Chạy trơn `./install.sh` thì chỉ cài skills,
nếu bạn thật sự chỉ cần bấy nhiêu.

| Flag | Làm gì |
|---|---|
| *(không có)* | Symlink `skills/` vào `~/.claude/skills/`, để mở repo nào cũng có. |
| `--tools` | Cài một CLI theo hai cách: một **symlink** ở `~/.local/bin/colab` cho các phiên làm việc của bạn (có kiểm tra thư mục đó thật sự nằm trong `PATH` không, thiếu thì in ra đúng dòng cần thêm), cộng một **bản đóng băng** có đóng dấu ở `~/.colab/bin/colab` cho các service luôn-bật — xem ngay dưới. |
| `--hooks` | Trỏ git của clone này vào `.githooks/`, ở đó `pre-commit` chạy lần lượt mọi check trong `pre-commit.d/` — quét secret bằng gitleaks, và quét danh tính (identity) vốn cần một danh sách từ khoá do bạn cấp bằng đường dẫn và giữ NGOÀI mọi repo (xem [`templates/README.md`](templates/README.md)). `core.hooksPath` nằm trong `.git/config` nên là cấu hình per-clone, per-máy, không đi theo repo. |
| `--fleet` | Tạo `~/.colab/repos.txt` từ `audit/repos.txt`, chỉ khi file chưa tồn tại. Danh sách đó cố tình nằm ngoài repo: nó ghi tên các repo private của bạn, còn repo này thì public. |
| `--all` | `--tools --hooks --fleet`. |
| `--dry` | In ra sẽ làm gì, không thay đổi gì. Ghép được với mọi flag trên. |

**Service luôn-bật phải gọi `~/.colab/bin/colab`.** Bản CLI symlink chạy theo
đúng nhánh mà clone này đang checkout — với một phiên làm việc của con người thì
đó là chủ đích, nhưng với thứ sống lâu hơn một phiên thì đó là sai. Một daemon,
một launch agent hay một runner headless bật từ mấy tháng trước sẽ âm thầm đổi
hành vi chỉ vì ai đó checkout một nhánh chẳng liên quan, mà không có gì báo cả:
tiến trình vẫn chạy, chỉ là chạy khác đi. Nên `--tools` còn ghi thêm một **bản
copy** vào `~/.colab/bin/` (có tôn trọng `COLAB_HOME`), đóng dấu version handbook
mà nó được lấy ra — hoặc, khi cây làm việc đó đang đi trước tag gần nhất, đóng dấu
đúng commit mà nó được lấy ra (`v1.7.0-2-gc8436c6`) kèm một cảnh báo, vì không
version phát hành nào mô tả đúng đống byte đó. Bản copy đó không bao giờ tự thay đổi.

Vì vậy làm mới nó là một hành động chủ ý, không phải hệ quả phụ: chạy lại
`./install.sh --tools`. `colab update` sẽ cho biết khi nào đến lúc. **`behind`
nghĩa là đã có một thay đổi CLI ĐÃ PHÁT HÀNH mà máy này chưa có** — phép so sánh
chạy tới tag gần nhất, nên một bản phát hành không đụng gì tới code CLI sẽ không
càm ràm bạn, mà công việc chưa phát hành trong chính checkout của bạn cũng vậy.
(Vế sau chính là lý do mốc trên là tag chứ không phải `HEAD`: đo tới `HEAD` khiến
mọi máy bị đánh dấu cũ suốt quãng từ lúc commit CLI tới tag kế tiếp, mà cách khắc
phục được quảng cáo lại copy *từ* chính cây làm việc đó — nên trên máy đang phát
triển handbook, nó khuyên các service nạp code chưa phát hành.) Nó không bao giờ
ghi đè bản copy, kể cả với `--apply`: đó là bộ công cụ mà các service đang chạy
của bạn đang thực thi. `colab --version` cho biết bạn đang nói chuyện với bản nào.

**3. Kiểm lại, rồi chỉ cho audit biết phải soi repo nào.**

```sh
colab --help                 # không thấy lệnh? sửa PATH — bước 2 in sẵn dòng cần thêm
colab --version              # colab nào đây: bản working tree hay bản đóng băng?
$EDITOR ~/.colab/repos.txt   # thay các dòng ví dụ bằng repo của bạn
node audit/audit.mjs         # báo cáo conformance cho toàn bộ fleet
colab update                 # các bản copy có đóng dấu đã tụt lại — kể cả CLI đóng băng
```

Xong thì đọc [`CONVENTIONS.md`](CONVENTIONS.md): mất ~15 phút, và là file chuẩn
tắc duy nhất ở đây.

## Adopt vào một repo

Bản rút gọn — checklist đầy đủ ở
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this):

1. Trả lời câu 1 một cách trung thực (có production **hôm nay** không, chứ
   không phải "sắp có").
2. Thêm `.github/project.yml`. `colab adopt` hỏi năm câu rồi ghi file giùm bạn —
   nó dừng ở phần descriptor và in ra phần còn lại của danh sách này, vì mấy
   bước sau không phải việc của nó.
3. `colab labels --ensure` — các label quy ước không có sẵn, và không phải chỉ
   một cái. Một check mà label của nó chưa từng được tạo thì không bao giờ chạy
   được.
4. Dán [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md) vào
   `CLAUDE.md` của repo — đây là cách duy nhất để agent phát hiện ra bộ quy ước
   này.
5. Đảm bảo CI đạt hai kết quả bắt buộc: quét secret và build, với phiên bản
   toolchain **resolve từ manifest của chính repo** — không bao giờ hardcode.
   Copy template nếu thấy tiện.

Nhánh có sẵn từ trước được **giữ nguyên** (grandfathered). Đừng đổi tên gì cả.

## Vì sao ép buộc ít vậy

Các repo private của chúng ta nằm trên gói GitHub không có branch protection —
không thể cấm push vào `main`. Nên handbook này không giả vờ ép buộc; nó làm
cho việc **tuân thủ rẻ và việc kiểm tra rẻ**. Audit tool báo drift; quy ước
giải thích *vì sao* từng luật tồn tại để bạn tự phán đoán khi nào đáng phá luật.
Khi phá, hãy sửa tài liệu trong cùng PR — một tài liệu mô tả một repo không tồn
tại là thứ tệ nhất trong nghề này.

**Có hai thứ thì chặn thật, và ranh giới đó là cố ý.** Git hook thì từ chối:
một bản quét secret, và một bản quét danh tính chặn không cho tên máy, đường dẫn
home hay tên khách hàng lọt vào một repo public. Chúng canh phần **phát hành ra
ngoài** — sai lầm duy nhất không thể sửa được, vì history không thu hồi lại được
một khi đã có người clone. Mọi thứ thuộc về *conformance* vẫn chỉ là cảnh báo:
sai một quy ước thì tốn một cuộc trao đổi, còn sai chuyện phát hành thì tốn vĩnh
viễn.

## Giấy phép

[Apache License 2.0](LICENSE). Cứ copy những gì thấy dùng được — repo này sinh
ra để làm việc đó. Giấy phép là nửa pháp lý của "copy-and-own": bạn được dùng,
sửa và phát hành lại mọi thứ ở đây, kể cả trong sản phẩm đóng mã nguồn, miễn là
giữ lại phần ghi chú bản quyền. Nó cũng kèm một điều khoản cấp quyền sáng chế
rõ ràng, và giữ lại quyền với thương hiệu của dự án.

Việc bạn adopt một quy ước không tốn gì của bạn và cũng không cho chúng tôi
quyền gì. Không có gì ở đây gửi dữ liệu về, và không có nghĩa vụ đóng góp ngược.
