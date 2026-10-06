[English](README.md) · ***Tiếng Việt***

# colab-handbook

Bộ quy ước và công cụ nhỏ để vận hành nhiều repo — nhiều phiên code song song,
người thật lẫn AI agent — mà không giẫm chân nhau.

**Nếu bạn là AI agent, dừng ở đây và đọc [`CLAUDE.md`](CLAUDE.md).**
File này dành cho con người.

## Bắt đầu nhanh

```sh
git clone https://github.com/futurelastic/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook && ./install.sh --all   # skills + CLI colab + hook, từ bản phát hành mới nhất; --dry để xem trước
cd /duong-dan/toi/repo-cua-ban
colab adopt              # chỉ hỏi những gì không tự dò ra được, rồi ghi .github/project.yml
colab labels --ensure    # tạo các label quy ước
colab register           # đưa repo vào danh sách fleet của máy này
```

Sau đó, trong một phiên agent ở repo đó, chạy `/code-start <số-issue>`. Có agent
trong tay thì `/handbook-sync` thay được ba lệnh cuối và làm nốt phần adopt còn
lại (xem [*Adopt vào một repo*](#adopt-vào-một-repo)). Cần có `git`, `node` ≥ 18
và `gh` ≥ 2.94 đã đăng nhập (`gh auth login`); gói `gh` của các distro thường cũ
hơn, nên hãy cài từ [cli.github.com](https://cli.github.com).

*([`CONVENTIONS.md`](CONVENTIONS.md) là tài liệu chuẩn tắc, viết bằng tiếng Anh
để agent và tool đọc được. File này và bản tiếng Anh [`README.md`](README.md)
chỉ là cửa vào. Khi hai bản nói khác nhau thì **cả hai đều sai** cho tới khi
khớp lại với `CONVENTIONS.md`.)*

## Đây là cái gì

Một cuốn **handbook, không phải framework**. Nó quyết định **kết quả** — code
merge vào đâu, release là gì, báo "tôi đang làm việc này" bằng cách nào — và cố
tình để **cách hiện thực** (phiên bản Node, test runner, file CI của bạn) cho
từng repo tự quyết.

Nó được chưng cất từ việc vận hành một fleet repo thật, trong đó có nhiều app
production được bảo trì gần như hoàn toàn bởi AI agent chạy song song trên nhiều
worktree. Mục anti-pattern không phải lý thuyết: từng mục là chuyện đã xảy ra
thật.

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

Nó bắt mỗi repo tự trả lời năm câu hỏi về chính mình, **một lần**, vào một file
mà mọi phiên đều đọc trước khi động vào bất cứ thứ gì (xem [*Năm câu
hỏi*](#năm-câu-hỏi)). Mọi thứ còn lại suy ra từ mấy câu trả lời đó: merge vào
nhánh nào, ở repo này release nghĩa là gì, có bắt buộc phải có nhánh không, một
phiên phải ghi lại bao nhiêu trước khi dừng.

Phần còn lại của repo phục vụ điều đó: một CLI làm giúp phần cơ học, một audit
báo chỗ nào thực tế đã trôi khỏi thứ repo tự khai, và các luồng phiên làm việc
(skill) để phiên code ở đâu cũng mở ra và đóng lại giống nhau. Skill chỉ là văn
xuôi — một người ngồi terminal có thể làm theo mà không cần agent hay tool nào
khác.

### Nó không phải cái gì

- **Không phải một service.** Không có gì ở đây là dependency và không có gì gửi
  dữ liệu về. Bạn copy cái nào thấy dùng được rồi sở hữu bản copy đó — fork,
  sửa, xoá bớt nửa cũng được. Giấy phép sinh ra để làm việc đó.
- **Không phải hệ thống CI, cũng không có ý kiến gì về stack của bạn.** Ngôn
  ngữ, test runner, pipeline — của bạn cả. Handbook chỉ yêu cầu pipeline cho ra
  hai kết quả, và không bao giờ nói phải làm bằng cách nào.
- **Phần lớn không phải lớp ép buộc.** Chuyện tuân thủ chỉ là cảnh báo. Vài thứ
  ít ỏi thật sự chặn được liệt kê ở [*Vì sao ép buộc ít
  vậy*](#vì-sao-ép-buộc-ít-vậy).
- **Không phải thang đo độ trưởng thành.** Không câu trả lời nào ở đây xếp repo
  này trên repo kia. Một repo chưa có production không phải repo tệ hơn; nó là
  repo có ít cổng hơn.

## Phiên làm việc đầu tiên

Mỗi đầu việc đi qua một vòng. Mỗi bước là một skill, gọi trong phiên agent bằng
slash command (`/code-start 42`), hoặc tự làm theo bằng tay từ
[`skills/`](skills/).

| Bước | Skill | Ai chạy | Để lại gì |
|---|---|---|---|
| 1. Chọn | `/code-triage` | điều phối | việc sẵn sàng theo thứ tự, label `group:` trên các issue phải chung một nhánh, `needs-plan` trên việc khó, lệnh để bắt đầu |
| 2. Mở | `/code-start <N>` | thợ | issue đã claim, nhánh cắt từ trunk và đã push, một worktree, một file plan ngắn |
| 3. Làm | — | thợ | commit trên nhánh |
| 4. Bàn giao | `/code-wrap` | thợ | điều học được ghi lên Issue, gate của repo đã chạy, nhánh đã push — rồi **dừng** |
| 5. Merge | `/code-ship` | điều phối, sau khi người đồng ý | một squash commit trên trunk kèm `Closes #N`, bằng chứng trên từng issue, claim đã nhả, worktree đã gỡ |
| 6. Dọn | `/code-sweep` | điều phối | việc đã xong được ship, claim và worktree cũ được dọn |
| 7. Release | release workflow, hoặc `/release-rung` | tự động, hoặc người khi tag là thứ deploy | một tag ứng viên, rồi bản final sau thời gian thử — chỉ khi `exposure` của repo có release |

Cũng trong [`skills/`](skills/): `code-plan` (plan đầy đủ cho issue khó, do
`code-start` gọi khi có cờ), `handbook-sync` (kéo một repo lên bản handbook mới
nhất), và `migration-review` (review migration của một nhánh, cho người/agent
được repo gán vai đó).

**Mấy từ sẽ gặp:**

- **Trunk** — nhánh các phiên merge vào (`trunk:` trong `project.yml`).
  **Promotion** — merge trunk vào `main` khi trunk không phải `main`; ở repo
  `live` thì chính cú promote *là* deploy.
- **Claim** — assignee + label `in-progress`, có nhánh đã push lên remote làm
  bằng, lấy *trước khi* bắt tay vào làm.
- **Thợ / điều phối** (implementer / coordinator) — phiên viết code / phiên
  chọn việc, merge và dọn dẹp. Một người có thể làm cả hai, ở hai thời điểm.
- **Phase A / Phase B** — `code-wrap` (nửa của thợ, dừng trước mọi cú merge) /
  `code-ship` (nửa của điều phối: cú merge và mọi thứ sau đó).
- **Nấc (rung)** — phiên viết bao nhiêu plan: 0 không viết, 1 một khung năm
  dòng, 2 plan đầy đủ từ `code-plan`.

Người mới: đọc [`CONVENTIONS.md` §1](CONVENTIONS.md#1-the-model-in-one-picture)
(mô hình) và [§11](CONVENTIONS.md#11-quick-reference) (tra nhanh) trước. Phần
còn lại của `CONVENTIONS.md` là tài liệu tra cứu — cần gì tra nấy, đừng đọc từ
đầu tới cuối.

## Năm câu hỏi

Adopt nghĩa là trả lời mấy câu này về repo của bạn, một lần, vào
`.github/project.yml`. `colab adopt` hỏi chúng dưới dạng menu đánh số:

| # | Câu hỏi | Ghi vào |
|---|---|---|
| 1 | **Hôm nay** (chứ không phải "sắp") đã có đích deploy chưa, và đến đó bằng đường nào — một tag, chính cú promote, một người chạy runbook, hay chưa có gì? | `production` + `deploy` |
| 2 | Còn ai khác làm ở đây — một mình bạn, một team, hay có cả người ngoài? | `room` |
| 3 | Merge nhầm thì cái gì hỏng — không gì cả, chỉ những người đang có mặt, người dùng qua lần promote kế tiếp, hay người dùng/người adopt qua một artifact đã phát hành? | `exposure` |
| 4 | Một người có được commit thẳng vào trunk song song với các phiên worktree không — tự do, có khai ý định, hay không bao giờ? | `writes` |
| 5 | Code đi tới chỗ nó chạy bằng đường nào — một workflow CI, một git hook, một quy trình tay có ghi lại, một checkout đang sống, một artifact phát hành, dữ liệu của hệ thống khác, hay chưa có đường nào? | `channels` |

Không câu nào hỏi cái repo đã tự nói sẵn — nhánh mặc định (`trunk`), toolchain,
port đều được tự dò. Số cổng, nghi thức release và việc có bắt buộc phải có
nhánh hay không đều suy ra từ câu trả lời. Mỗi câu trả lời quy về đâu, và vì
sao: [`CONVENTIONS.md` §2](CONVENTIONS.md#2-tiers) và
[§9](CONVENTIONS.md#9-adopting-this); từng field:
[`project.schema.md`](project.schema.md).

## Adopt vào một repo

**Đường mặc định: chạy `/handbook-sync` trong một phiên agent ngay trong repo
đó.** Nó nhận ra repo chưa adopt gì và đi hết đường adopt — descriptor (qua
`colab adopt`), label, block `CLAUDE.md`, CI từ template, và đăng ký trên máy
này. Chạy lại về sau, chính skill đó kéo một repo đã adopt lên bản handbook mới
nhất mà không làm mất phần bạn đã sửa.

Làm bằng tay thì cũng đúng các bước đó (checklist đầy đủ:
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this)):

1. `colab adopt` — trả lời năm câu hỏi và ghi `.github/project.yml`. Nó dừng ở
   đó và in ra các bước còn lại.
2. `colab labels --ensure` — các label quy ước không có sẵn. Một check mà label
   của nó chưa từng được tạo thì không bao giờ chạy được.
3. Dán [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md) vào
   `CLAUDE.md` của repo — đây là cách agent phát hiện ra bộ quy ước.
4. Đảm bảo CI đạt hai kết quả bắt buộc: quét secret và build, với phiên bản
   toolchain **resolve từ manifest của chính repo**, không bao giờ hardcode.
   Copy template từ [`templates/`](templates/) nếu thấy tiện.
5. `colab register` — đưa repo vào danh sách fleet của máy này, để cả audit lẫn
   bộ cấp port đều biết tới nó.

Mấy flag của `colab adopt` nên biết:

- `--autonomy auto-trunk` — ghi lại quyền maintainer cấp cho agent tự hoàn tất
  cú merge vào trunk qua `colab ship` (không bao giờ là release). Cần người.
- `--land` — commit những gì lần chạy này ghi thẳng vào trunk rồi push, để
  nhánh feature đầu tiên được xét theo luật mới. Cần người (`COLAB_HUMAN=1`
  kèm `--answered-by`).
- `--fork` — repo bám theo một upstream không phải của bạn (tự dò khi có remote
  tên `upstream`); khi đó block `CLAUDE.md` chỉ được nối thêm, không bị cấu trúc
  lại, và workflow agent riêng của upstream được nêu tên.
- `--local` — bạn hoàn toàn không commit được vào repo này; mọi thứ nằm trong
  bản clone của bạn ([*Working in a repo you don't
  own*](CONVENTIONS.md#working-in-a-repo-you-dont-own)).

Nhánh có sẵn từ trước được **giữ nguyên** (grandfathered). Đừng đổi tên gì cả.

## Tuỳ biến một skill cho repo của bạn

Muốn một skill chạy khác đi ở một repo — comment Issue bằng tiếng Nhật, thêm
một bước kiểm tra trước wrap? Đừng fork skill: bản fork không còn nhận cập nhật
từ handbook. Hãy viết phần khác biệt vào `.colab/skills/<skill>.md` (ví dụ
`.colab/skills/code-wrap.md`), bằng văn xuôi thường. Mỗi skill đọc file đó
trước các bước của chính nó, và nội dung file thắng phần chữ của skill trong
repo đó. Nó không bao giờ nới một cổng của `colab`: claim hay merge đã bị từ
chối thì vẫn bị từ chối.

Claude Code tự nạp file vào skill. Các engine khác có một câu thường trong mỗi
skill bảo agent đọc file, cách này chạy được mà không cần engine hỗ trợ gì.
Vì file này ra lệnh cho agent, thay đổi trong nó không bao giờ được coi là
docs-only: nó merge bằng `auto-trunk` hoặc khi có người duyệt, giống một thay đổi
`CLAUDE.md`. Quy tắc:
[`CONVENTIONS.md` §8, *Local policy*](CONVENTIONS.md#local-policy--a-repo-refines-a-skill-without-forking-it-520).

## Tự động hoá tùy chọn, đặt lên trên

Không có gì ở đây giả định đã có dashboard, scheduler hay bot. Người adopt vẫn
có thể tự dựng: mở phiên từ một nút bấm, chạy vòng làm việc theo lịch, coi cú
bấm nút merge của một người là cái gật đầu mà `code-ship` đang chờ, hay đẩy
thông báo khi việc đổi trạng thái. Tool như vậy đọc đúng những artefact chung mà
con người đọc — `.github/project.yml`, label, claim trên từng Issue, file
`~/.colab/state.json` trên máy — và có thể nhận event của `colab` ở `notifyUrl`
([`tools/README.md`](tools/README.md#notifyurl--optional-event-push-off-by-default)).
Nó không bao giờ thay đổi một cổng của `colab`: cái gật đầu trước khi merge và
quyền cấp trước khi chạy migration vẫn đứng vững dù có nó hay không.

## Cấu trúc repo

| Đường dẫn | Là gì |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | Luật. Chuẩn tắc, nguồn sự thật duy nhất (EN). |
| [`CLAUDE.md`](CLAUDE.md) | Cửa vào cho AI agent — bản chưng cất vận hành (EN). |
| [`project.schema.md`](project.schema.md) | Tham chiếu field của `.github/project.yml`. |
| [`templates/`](templates/) | Điểm khởi đầu **copy-về-là-của-bạn**: CI, release, git hook (một bản quét secret và một bản quét danh tính), và block `CLAUDE.md` cho repo adopt. Không có gì được gọi từ xa — copy, sửa, sở hữu. |
| [`tools/`](tools/) | `colab` — một CLI nhỏ (tùy chọn): adopt một repo, claim issue, cấp port, quản lý worktree, và merge nhánh đã xong vào trunk khi repo cho phép. State JSON, không dependency. Tham chiếu các lệnh: [`tools/README.md`](tools/README.md). |
| [`audit/`](audit/) | Trình kiểm tra conformance từ bên ngoài. Đọc mọi repo của bạn — mọi owner, kể cả repo local-only — và báo drift trong một lần chạy. Chỉ cảnh báo. Thêm `--identity` thì quét cả description và topic của repo public — thứ mà không git hook nào nhìn thấy được. Ý nghĩa từng check: [`audit/README.md`](audit/README.md). |
| [`skills/`](skills/) | Luồng phiên làm việc — xem [*Phiên làm việc đầu tiên*](#phiên-làm-việc-đầu-tiên). `install.sh` cài chúng thành skill Claude Code. |
| [`install.sh`](install.sh) | Cài đặt cho **máy của bạn**: skills, CLI `colab`, hook pre-commit, danh sách fleet. Idempotent; `--dry` cho xem trước mọi thứ. |

## Cài đặt máy

Làm một lần cho mỗi máy. Clone vào chỗ ở lâu dài — các skill là symlink trỏ
*thẳng vào working tree này*, nên repo đang checkout cái gì thì mọi phiên dùng
đúng bản skill đó. `install.sh` kiểm tra đủ điều kiện trước khi đụng vào gì,
không bao giờ ghi đè thứ nó không tạo ra, và `--dry` in kế hoạch ra trước.

**Bạn nhận phiên bản nào.** `main` chạy trước bản phát hành chính thức cuối
cùng, nên lần cài đầu tiên từ một bản clone mới sẽ checkout **tag phát hành
chính thức mới nhất** (`vX.Y.Z`, không bao giờ là bản ứng viên) rồi cài từ đó —
giống mặc định của npm. Muốn theo `main`, kể cả phần chưa phát hành, thì chạy
lần cài đầu với `--trunk`. Lần chạy nào cũng in ra bạn đang ở bản nào. Đổi về
sau đều phải chủ động:

- lên bản phát hành mới hơn: `./install.sh --release`;
- từ một bản phát hành quay về `main`: `git checkout main && ./install.sh --trunk`
  (installer của bản phát hành cũ không biết `--trunk`, nên checkout `main` trước).

Clone đang có thay đổi chưa commit thì không bao giờ bị chuyển, và chạy lại
không kèm flag nào thì giữ nguyên thứ đang checkout.

| Flag | Làm gì |
|---|---|
| *(không có)* | Symlink `skills/` vào `~/.claude/skills/`, để mở repo nào cũng có. |
| `--tools` | CLI `colab` cài hai lần: một **symlink** ở `~/.local/bin/colab` cho các phiên làm việc của bạn (in sẵn dòng `PATH` nếu cần), và một **bản đóng băng** có đóng dấu ở `~/.colab/bin/colab` cho các service luôn-bật. Đồng thời tạo `~/.colab/state.json` rỗng nếu chưa có. |
| `--hooks` | Trỏ git của clone này vào `.githooks/`: quét secret bằng gitleaks, và quét danh tính với danh sách từ khoá do bạn giữ NGOÀI mọi repo (xem [`templates/README.md`](templates/README.md)). |
| `--fleet` | Tạo `~/.colab/repos.txt` chỉ chứa ghi chú định dạng, nếu chưa có. Nó cố tình nằm trên máy vì nó ghi tên các repo private của bạn; `colab register` mới là thứ điền vào. |
| `--all` | `--tools --hooks --fleet`. |
| `--notify-url <url>` | Ghi `notifyUrl` vào `~/.colab/config.json`, chỉ khi khoá đó chưa có. Xem [`tools/README.md`](tools/README.md#notifyurl--optional-event-push-off-by-default). |
| `--release` | Checkout clone này về tag phát hành chính thức mới nhất, rồi cài. Là mặc định cho lần cài đầu từ một bản clone mới. |
| `--trunk` | Checkout `main` rồi cài, kể cả phần chưa phát hành — `@next` của bản clone. |
| `--dry` | In ra sẽ làm gì, không thay đổi gì. Ghép được với các flag trên. |
| `--check` | Báo cáo sức khoẻ **chỉ đọc** cho một lần cài trước đó — xem bên dưới. Không nhận flag nào khác; exit 1 nếu có dòng ✗. |

**Service luôn-bật (launch agent, daemon, runner headless) phải gọi
`~/.colab/bin/colab`, không gọi symlink**, vì symlink chạy theo đúng nhánh mà
clone này đang checkout. Bản đóng băng không bao giờ tự thay đổi: `colab update`
báo khi nó tụt sau một thay đổi CLI đã phát hành, và chạy lại `./install.sh
--tools` để làm mới. Vì sao lại làm vậy:
[`tools/README.md`](tools/README.md#install).

**Chỉ cần CLI, không cần skill** thì có trên npm: **`@futurelastic/colab-handbook`**.
Chưa có bản phát hành chính thức nào lên npm, nên tag mặc định `latest` chỉ là
bản giữ chỗ; hãy cài từ **`@next`**, các bản ứng viên: `npx
@futurelastic/colab-handbook@next <lệnh>`, hoặc `npm i -g
@futurelastic/colab-handbook@next`. Lệnh gõ vẫn là `colab`. Skill không nằm trong package; chúng cài từ một bản clone, vì phải
symlink vào `~/.claude/skills/`.

### Kiểm tra bản cài

```sh
colab --version          # colab nào đang trả lời — working tree, bản đóng băng hay npm package — và phiên bản của nó
./install.sh --check     # chỉ đọc; exit 1 nếu có dòng ✗
node audit/audit.mjs     # báo cáo conformance cho mọi repo đã đăng ký
colab update             # các bản copy có đóng dấu đã tụt lại, kể cả CLI đóng băng
```

`--check` báo bản đóng băng có tụt sau bản phát hành mới nhất không và lệnh nào
nó không chạy được, file state có tồn tại không, đã đăng ký repo nào chưa, cả
hai hooklet pre-commit có chạy được không, và `notifyUrl` có đang trống trong
khi một observer trên máy đã khai endpoint không. ✗ nghĩa là thứ đã cài đang cũ
hoặc không dùng được; ⚠ nghĩa là có thứ chưa từng được cài, có thể là cố ý hoặc
chỉ là chưa làm tới — nên một bản cài mới đúng, chưa đăng ký repo nào và chưa có
danh sách từ khoá danh tính, sẽ ra các dòng ⚠ và exit 0. Nó không bao giờ tự làm
mới gì cả. `--check` không có trong v1.11.0 trở về trước; ở những bản đó, hãy theo
`main` để có nó.

## Vì sao ép buộc ít vậy

Không phải gói GitHub nào, owner nào trong một fleet cũng có branch protection,
nên handbook này không dựa vào nó. Thay vào đó nó làm cho việc **tuân thủ rẻ và
việc kiểm tra rẻ**: audit báo drift, còn quy ước giải thích *vì sao* từng luật
tồn tại để bạn tự phán đoán khi nào đáng phá luật. Khi phá, hãy sửa tài liệu
trong cùng thay đổi đó — một tài liệu mô tả một repo không tồn tại là thứ tệ
nhất trong nghề này.

**Một danh sách ngắn thì chặn thật, và là cố ý:**

- **Phát hành ra ngoài.** Git hook từ chối secret, và bản quét danh tính chặn
  tên máy, đường dẫn home hay tên khách hàng lọt vào một repo public. History
  không thu hồi lại được một khi đã có người clone.
- **Các cổng quanh cú merge**, do `colab` canh: người phải đồng ý trước khi
  merge (trừ khi repo đã cấp `auto-trunk` hoặc thay đổi chỉ là docs), phải có
  quyền cấp trước khi một migration được ship, và release không bao giờ đi kèm
  cú merge.

Mọi thứ khác là mặc định — một cách làm tốt — vì sai một quy ước thì chỉ tốn
một cuộc trao đổi.

## Giấy phép

[MIT License](LICENSE). Cứ copy những gì thấy dùng được — repo này sinh
ra để làm việc đó. Giấy phép là nửa pháp lý của "copy-and-own": bạn được dùng,
sửa và phát hành lại mọi thứ ở đây, kể cả trong sản phẩm đóng mã nguồn, miễn là
giữ lại phần ghi chú bản quyền. Nó cũng kèm một điều khoản cấp quyền sáng chế
rõ ràng, và giữ lại quyền với thương hiệu của dự án.

Việc bạn adopt một quy ước không tốn gì của bạn và cũng không cho chúng tôi
quyền gì. Không có gì ở đây gửi dữ liệu về, và không có nghĩa vụ đóng góp ngược.
