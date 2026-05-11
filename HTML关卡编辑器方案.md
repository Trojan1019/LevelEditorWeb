# HTML 关卡编辑器方案

## 1. 目标

基于当前 Unity 关卡编辑器的需求与数据链路，新增一套 HTML/Web 版关卡编辑器，用于让策划、测试或非 Unity 使用者更低成本地编辑关卡 JSON。

这套工具的第一阶段目标不是替代 Unity 的完整构建流程，而是把“关卡设计体验”从 Unity Editor 中拆出来：

```text
HTML 关卡编辑器
  -> 编辑 Assets/Game/Level/level_*.json
  -> Unity 工程继续生成 JokerSheepLevel.csv
  -> Unity 工程继续生成 JokerSheepLevel.bytes
  -> 游戏运行时继续读 DataTable
```

核心原则：

- HTML 工具负责关卡编辑体验。
- Unity 工程负责正式导表和打包。
- `level_*.json` 继续作为唯一关卡编辑源。
- 不在浏览器第一阶段实现 `csv -> bytes` 生成。

---

## 2. 为什么做 HTML 版

当前 Unity Editor 版关卡编辑器已经接入了正式链路，但它有几个天然限制：

- 使用者必须安装 Unity。
- 打开工程成本高。
- Unity Editor 窗口做复杂拖拽、批量管理和可视化体验不如 Web 灵活。
- 非程序人员调关卡时容易误触工程资源、场景和配置。
- 后续如果要多人协作、云端保存、批量校验，Web 形态更自然。

HTML 版的价值在于：

- 打开成本低。
- 可以作为本地工具运行，也可以后续部署成内部网页。
- 更适合做可视化布局、批量校验、搜索筛选、差异对比。
- 可以把关卡编辑体验做得比 Unity Editor 更接近专用工具。

---

## 3. 不建议做 PC exe 的原因

单独 PC exe 的主要问题是维护成本高：

- 要处理安装包、更新、路径配置、权限和环境问题。
- 仍然要重新实现一套 UI、拖拽、校验和文件读写。
- 如果用 Unity 导出 exe，本质上又多维护一个 Unity 工具项目。
- 如果用其他框架导出 exe，最后仍然绕不开 Web 技术或桌面壳。

相比之下，HTML 工具可以先做成轻量本地页面，后续再决定是否套 Electron 或接服务端。

结论：

```text
Unity Editor 工具：继续作为正式导表入口。
HTML/Web 工具：作为更好的关卡编辑入口。
PC exe：暂不作为优先方向。
```

---

## 4. 推荐技术形态

### 4.1 第一阶段推荐形态

推荐做一个本地 Web 单页工具：

```text
Tools/LevelEditorWeb/
  package.json
  index.html
  src/
    main.ts
    app/
    domain/
    editor/
    validation/
    storage/
```

推荐技术：

- `Vite`
- `TypeScript`
- `React`
- `Canvas` 或 `SVG` 绘制牌桌
- `File System Access API` 读写本地 `Assets/Game/Level` 目录

理由：

- `TypeScript` 更适合维护 JSON schema、校验规则和坐标计算。
- `React` 适合做复杂表单、列表、状态同步。
- `Canvas/SVG` 都能做牌桌编辑，第一阶段优先 `SVG`，因为单个槽位可直接响应点击、拖拽和选中态。
- `File System Access API` 可以在 Chrome / Edge 里直接选择本地目录并写回文件。

### 4.2 浏览器兼容方案

浏览器本地写文件有权限限制，因此需要两套模式：

1. `本地目录模式`
   - 使用 Chrome / Edge。
   - 用户选择 `Assets/Game/Level` 目录。
   - 工具直接读写 `level_*.json`。

2. `导入导出模式`
   - 兼容不支持本地目录 API 的浏览器。
   - 用户手动导入 JSON。
   - 编辑后下载 JSON。
   - 不直接写回工程目录。

第一阶段建议优先实现本地目录模式，导入导出模式作为兜底。

---

## 5. 数据边界

### 5.1 HTML 工具直接维护的文件

只维护：

```text
Assets/Game/Level/level_*.json
```

### 5.2 HTML 工具不直接维护的文件

第一阶段不直接生成：

```text
Doc/Excel/csv/JokerSheepLevel.csv
Assets/Game/DataTables/JokerSheepLevel.bytes
Assets/Scripts/DataTables/DRJokerSheepLevel.cs
```

这些仍然由 Unity 菜单生成：

```text
Tools/Trojan/Excel/Generate JokerSheepLevel Csv From Json
Tools/Trojan/Excel/Generate DataTables
```

### 5.3 后续可选增强

第二阶段可以增加一个本地 Node CLI：

```text
node tools/level-editor-web/scripts/export-joker-level-csv.mjs
```

用于把 JSON 转成 `JokerSheepLevel.csv`。

但 `bytes / DR*.cs` 仍建议继续由 Unity 生成，因为它依赖项目现有 GameFramework DataTable 生成器。

---

## 6. JSON Schema

HTML 工具必须完全沿用当前 `LevelConfigData` 结构。

```ts
type LevelConfigData = {
  Id: number;
  TitleKey: string;
  DescriptionKey: string;
  TotalCards: number;
  TargetScore: number;
  WinConditionMode: LevelWinConditionMode;
  PoolSuits: SuitCode[];
  PoolRanks: number[];
  SpecialWild: number;
  SpecialMultiplier: number;
  SpecialSuit: number;
  ItemStorage: number;
  ItemShuffle: number;
  ItemAddWild: number;
  BoardLayout: LevelBoardSlotData[];
  Objectives: LevelObjectiveData[];
};

type LevelBoardSlotData = {
  X: number;
  Y: number;
  Layer: number;
  Suit: BoardSuitCode;
  Rank: number;
};

type LevelObjectiveData = {
  HandType: string;
  Count: number;
  Reward: number;
};

type SuitCode = "H" | "D" | "C" | "S";
type BoardSuitCode = "N" | "H" | "D" | "C" | "S";

enum LevelWinConditionMode {
  ScoreOnly = 0,
  ObjectivesOnly = 1,
  ScoreAndObjectives = 2,
  ScoreOrObjectives = 3,
}
```

字段名必须保持 PascalCase，不能改成 camelCase。否则 Unity 的 `JsonUtility` 不能稳定读回。

### 6.1 BoardLayout 固定牌面字段

`BoardLayout` 当前不再只是坐标列表，每个槽位都需要携带可选固定牌面：

```json
{
  "X": -40,
  "Y": -40,
  "Layer": 0,
  "Suit": "H",
  "Rank": 2
}
```

字段规则：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Suit` | `BoardSuitCode` | 固定牌花色。`H` 红桃，`D` 方片，`C` 梅花，`S` 黑桃，`N` 表示不固定普通牌 |
| `Rank` | `number` | 固定牌点数。`2-10` 为数字牌，`11` J，`12` Q，`13` K，`14` A，`0` 表示不固定 |

兼容规则：

- 旧 JSON 没有 `Suit / Rank` 时，HTML 工具读入后按 `Suit: "N"`、`Rank: 0` 补齐。
- 新增槽位默认写入 `Suit: "N"`、`Rank: 0`。
- 复制槽位时必须同步复制 `Suit` 和 `Rank`，否则复制后的布局会和运行时牌面不一致。
- `PoolSuits` 仍然只能使用 `H/D/C/S`，不能包含 `N`；`N` 只允许出现在 `BoardLayout[].Suit`。

---

## 7. 功能模块设计

### 7.1 关卡列表

功能：

- 选择工程关卡目录。
- 扫描所有 `level_*.json`。
- 按 `Id` 排序。
- 展示关卡编号、文件名、总牌数、目标分数、胜利模式、布局状态。
- 支持搜索 `Id / 文件名 / TitleKey`。
- 支持筛选：
  - 有错误
  - 有警告
  - 显式布局生效
  - 显式布局未生效

推荐列表字段：

- `Id`
- `FileName`
- `TotalCards`
- `BoardLayout.Count`
- `WinConditionMode`
- `ErrorCount`
- `WarningCount`

### 7.2 文件操作

功能：

- 新建关卡
- 复制当前关卡
- 删除关卡
- 保存当前关卡
- 批量保存
- 恢复未保存修改
- 导入 JSON
- 导出 JSON

文件命名规则：

```text
level_{Id}.json
```

保存时规则：

- 如果 `Id` 改变，目标文件名也改变。
- 如果目标文件已存在，需要阻止保存。
- 如果原文件名与新文件名不同，保存新文件后提示用户旧文件将被移除。

第一阶段为了降低风险，建议对“改 Id 导致重命名”做显式确认。

### 7.3 基础信息面板

字段：

- `Id`
- `TitleKey`
- `DescriptionKey`
- `TotalCards`
- `TargetScore`
- `WinConditionMode`

交互建议：

- `Id / TotalCards / TargetScore` 使用数字输入。
- `WinConditionMode` 使用分段控件或下拉框。
- 当 `WinConditionMode` 不需要分数时，`TargetScore` 仍可编辑，但提示“当前模式不依赖分数”。
- 当 `TotalCards` 与 `BoardLayout.Count` 不一致时，在字段旁直接显示警告。

### 7.4 牌池面板

花色：

- `H`
- `D`
- `C`
- `S`

点数：

- `2` 到 `14`
- 显示层可以展示为 `2 3 4 5 6 7 8 9 10 J Q K A`
- 数据层继续保存整数。

交互建议：

- 花色使用四个 toggle。
- 点数使用紧凑 toggle 网格。
- 提供快捷按钮：
  - 全花色
  - 红色花色
  - 黑色花色
  - 全点数
  - 低点数
  - 高点数

快捷按钮只是编辑体验增强，不改变数据结构。

### 7.4.1 固定牌面编辑

当用户选中某个 `BoardLayout` 槽位时，需要在槽位属性面板里显示并编辑：

- `Suit`
- `Rank`

交互建议：

- `Suit` 使用下拉或五段按钮：`N / H / D / C / S`。
- `Rank` 使用下拉或数字输入，显示层可展示 `0 / 2 3 4 5 6 7 8 9 10 J Q K A`。
- 当 `Suit = N` 时，界面应自动把 `Rank` 置为 `0`，或至少强提示 `Rank` 不应参与运行时牌面。
- 当 `Suit != N` 时，`Rank` 必须在 `2-14`。
- 牌桌预览上应显示固定牌面，例如 `H2`、`S14`，不固定槽位显示 `N` 或空标识。

### 7.5 特殊牌面板

字段：

- `SpecialWild`
- `SpecialMultiplier`
- `SpecialSuit`

校验：

- 不能为负数。
- 三者总和不能超过 `TotalCards`。

界面上建议显示：

```text
特殊牌合计 / TotalCards
```

例如：

```text
5 / 40
```

### 7.6 道具面板

字段：

- `ItemStorage`
- `ItemShuffle`
- `ItemAddWild`

校验：

- 不能为负数。

这部分只决定局内初始次数，不决定道具购买价格。购买价格仍然由现有配置表或全局配置控制。

### 7.7 目标面板

每个目标包含：

- `HandType`
- `Count`
- `Reward`

功能：

- 添加目标
- 删除目标
- 调整目标顺序
- 修改牌型
- 修改次数
- 修改奖励

`HandType` 应使用固定枚举下拉，避免手写字符串。

需要覆盖当前 `HandType` 枚举的所有运行时牌型，例如：

- `HighCard`
- `Pair`
- `TwoPair`
- `ThreeOfAKind`
- `Straight`
- `Flush`
- `FullHouse`
- `FourOfAKind`
- `StraightFlush`
- `RoyalFlush`

具体枚举应以项目 `HandType` 为准，不在 Web 工具里另造语义。

---

## 8. 牌桌布局编辑器方案

这是 HTML 版最重要的模块。

### 8.1 目标

HTML 版布局编辑器需要达到：

- 可视化显示所有槽位
- 拖拽调整 `X / Y`
- 编辑 `Layer`
- 支持吸附网格
- 支持默认矩阵生成
- 支持补齐到 `TotalCards`
- 支持显式提示“当前布局是否会生效”
- 支持模拟遮挡和可点击状态

### 8.2 渲染方案

第一阶段推荐使用 `SVG`。

理由：

- 每张牌槽位可以是一个独立 `g` 节点。
- 点击、拖拽、右键菜单、hover 提示更容易。
- 缩放和坐标换算清晰。
- 后续导出截图也方便。

如果后续槽位数量大幅增加，再考虑切到 `Canvas`。

### 8.3 坐标参数

必须继承当前 Unity 编辑器的核心参数：

```text
SourceCardWidth = 42
SourceCardHeight = 66
DefaultSnapStepX = 21
DefaultSnapStepY = 19
SnapOriginX = 0
SnapOriginY = 0
```

运行时遮挡计算需要参考 `BoardService`：

```text
OcclusionWidth = 42
OcclusionHeight = 42 * 1.57
MinClickableVisibleAreaRatio = 0.7
```

### 8.4 布局生效提示

HTML 版必须把这条规则做成强提示：

```text
BoardLayout.Count == TotalCards 时，显式布局才会生效。
```

界面上建议显示三种状态：

- `生效`：`BoardLayout.Count == TotalCards`
- `少槽位`：`BoardLayout.Count < TotalCards`
- `多槽位`：`BoardLayout.Count > TotalCards`

并给出一键操作：

- `补齐到 TotalCards`
- `同步 TotalCards = 槽位数`
- `清空布局`

### 8.5 槽位操作

需要支持：

- 添加槽位
- 删除槽位
- 复制槽位
- 多选槽位
- 拖拽移动
- 键盘方向键微调
- 修改 `Layer`
- 修改固定牌面 `Suit / Rank`
- `Layer +1`
- `Layer -1`
- 移到顶层
- 移到底层
- 按层排序
- 全部吸附到网格

MVP 可以先做单选，第二阶段再做多选。

复制槽位时需要复制完整槽位数据：

```ts
{
  X,
  Y,
  Layer,
  Suit,
  Rank
}
```

### 8.6 默认矩阵

需要复刻 Unity 当前默认矩阵逻辑：

- 每层 `4 x 4`
- 每层最多 16 张
- 后续层数按 `index / 16` 增加
- 奇数层做错位

这样 HTML 生成出来的初始布局才能和 Unity 工具一致。

默认矩阵生成的新槽位需要写入：

```json
{
  "Suit": "N",
  "Rank": 0
}
```

这样可以保持旧的随机发牌行为，不会因为生成布局而意外固定所有牌面。

### 8.7 可点击状态预览

HTML 版可以比 Unity Editor 版更进一步，直接显示每张牌当前是否可点击。

计算方式应复刻 `BoardService.UpdateClickability()`：

- 找出所有未移除卡牌。
- 对每张目标牌计算遮挡矩形。
- 找出所有更高层级的覆盖矩形。
- 计算覆盖面积并集。
- 得出可见面积比例。
- `visibleAreaRatio >= 0.7` 时视为可点击。

显示建议：

- 可点击：正常亮度。
- 不可点击：降低透明度或加锁标识。
- hover 时显示：
  - `Index`
  - `X`
  - `Y`
  - `Layer`
  - `Suit`
  - `Rank`
  - `VisibleRatio`

这会让策划更容易理解为什么某些布局会卡住。

---

## 9. 校验系统方案

HTML 工具必须复刻 Unity 当前 `LevelEditorValidator` 的校验规则。

### 9.1 错误

应阻止保存或至少强提示的错误：

- `Id <= 0`
- 多个关卡 `Id` 重复
- 牌池花色为空
- 牌池点数为空
- 花色码不是 `H/D/C/S`
- 点数不在 `2..14`
- `BoardLayout[].Suit` 不是 `N/H/D/C/S`
- `BoardLayout[].Suit = N` 但 `Rank != 0`
- `BoardLayout[].Suit != N` 但 `Rank` 不在 `2..14`
- 特殊牌或道具数量为负
- 特殊牌总数超过 `TotalCards`
- 必须配置目标的模式下没有目标
- `HandType` 非法
- `Reward < 0`

### 9.2 警告

允许保存但应提示：

- `TotalCards < 5`
- `BoardLayout.Count != TotalCards`
- 槽位坐标绝对值过大，例如超过 `300`
- 同一 `Layer + X + Y` 重复
- 目标 `Count <= 0`

### 9.3 信息

普通提示：

- 当前布局为空，将使用运行时自动布局。
- 当前配置校验通过。

### 9.4 校验展示

建议固定一个右侧校验栏：

- 错误数
- 警告数
- 信息数
- 点击消息可以跳转到对应字段或槽位

这会比 Unity 当前的 HelpBox 列表更适合复杂关卡。

---

## 10. 保存与文件权限方案

### 10.1 本地目录模式

使用浏览器的 `showDirectoryPicker()`：

1. 用户点击 `选择关卡目录`
2. 选择 `Assets/Game/Level`
3. 工具读取所有 `level_*.json`
4. 保存时写回原文件

优点：

- 不需要后端。
- 不需要安装客户端。
- 和当前工程目录直接对接。

限制：

- 主要支持 Chrome / Edge。
- 每次打开工具可能需要重新授权目录。

### 10.2 导入导出模式

用于兜底：

- 用户拖入一个或多个 JSON。
- 工具在内存里编辑。
- 保存时下载 JSON 文件。

适合：

- 临时改单关
- 发给外部人员试用
- 没有本地工程目录权限的场景

### 10.3 后续服务端模式

如果后续要多人协作，可以增加服务端：

- 后端保存关卡 JSON
- 支持账号权限
- 支持版本历史
- 支持锁定和审核
- 支持导出整个关卡包

但这不建议放在第一阶段。

---

## 11. 与 Unity 工程的衔接

### 11.1 第一阶段衔接方式

第一阶段最稳的衔接：

1. HTML 工具写入 `Assets/Game/Level/level_*.json`
2. Unity 中执行 `Generate JokerSheepLevel Csv From Json`
3. Unity 中执行 `Generate DataTables`
4. 进入游戏验证

### 11.1.1 JSON 到数据表的新增字段

Unity 侧由 JSON 生成 `JokerSheepLevel.csv` 时，会把 `BoardLayout[].Suit` 和 `BoardLayout[].Rank` 展开成两个数组字段：

| CSV 字段 | 类型 | 来源 |
| --- | --- | --- |
| `BoardCardSuits` | `int[]` | `BoardLayout[].Suit` |
| `BoardCardRanks` | `int[]` | `BoardLayout[].Rank` |

花色映射必须与 Unity 保持一致：

| JSON | CSV 数值 | 含义 |
| --- | --- | --- |
| `N` | `0` | 不固定 |
| `H` | `1` | 红桃 |
| `D` | `2` | 方片 |
| `C` | `3` | 梅花 |
| `S` | `4` | 黑桃 |

HTML 第一阶段仍然只保存 JSON，不直接生成 bytes。即使后续加 Node CLI 生成 CSV，也必须按上表输出，不能另起一套字段名或枚举值。

### 11.1.2 运行时发牌逻辑变化

旧逻辑：

1. 根据 `PoolSuits` 和 `PoolRanks` 随机生成牌堆。
2. 如果 `BoardLayout.Count == TotalCards`，只把坐标和层级套到随机牌堆上。
3. 单个槽位不决定具体牌面。

新逻辑：

1. 如果 `BoardLayout` 中存在任意合法固定牌面，也就是 `Suit != "N"` 且 `Rank` 在 `2..14`，则启用固定牌面模式。
2. 固定牌面模式下，运行时按 `BoardLayout` 顺序生成棋盘牌。
3. 配置了合法 `Suit / Rank` 的槽位生成对应普通牌。
4. `Suit: "N", Rank: 0` 的槽位继续走原随机/特殊牌补位逻辑。
5. 固定牌面模式不会再对最终棋盘牌堆做随机打乱，否则牌面会和 `BoardLayout` 下标错位。

HTML 如果要做运行时预览，应使用同一判断：

```ts
const hasFixedBoardCards = level.BoardLayout.some(
  slot => slot.Suit !== "N" && slot.Rank >= 2 && slot.Rank <= 14
);
```

### 11.2 第二阶段可加命令行导出

可以把 `JSON -> JokerSheepLevel.csv` 抽成一个 Node 脚本，供 HTML 工具或 npm 命令调用：

```text
npm run export:levels
```

这样可以不打开 Unity 就生成 CSV。

但正式 `bytes` 仍应由 Unity 生成，避免和 GameFramework DataTable 序列化规则分叉。

### 11.3 不建议浏览器直接生成 bytes

原因：

- DataTable bytes 是项目框架格式。
- 如果 Web 里重新实现一份，很容易和 Unity 生成器不一致。
- 一旦框架升级或字段规则变化，会多一套维护成本。

---

## 12. MVP 范围

第一版建议只做能真正提升调关效率的功能。

### 12.1 必须做

- 选择 `Assets/Game/Level` 目录
- 扫描关卡列表
- 读取和保存 `level_*.json`
- 新建 / 复制 / 删除关卡
- 基础字段编辑
- 牌池编辑
- 特殊牌编辑
- 道具编辑
- 目标编辑
- SVG 牌桌布局编辑
- 添加 / 删除 / 拖拽槽位
- 吸附网格
- 默认矩阵
- 补齐到 `TotalCards`
- 同步 `TotalCards = 槽位数`
- 校验规则复刻
- 脏状态提示

### 12.2 暂不做

- 登录系统
- 云端保存
- 多人协作
- 复杂版本管理
- 直接生成 `bytes`
- 直接打包
- 运行完整游戏模拟

---

## 13. 第二阶段增强

第二阶段可以考虑：

- 批量校验所有关卡
- 批量修改目标分数
- 批量调整道具投放
- 关卡难度曲线视图
- 按关卡展示 `TotalCards / TargetScore / SpecialCards / Objectives`
- 关卡 JSON diff
- 布局模板库
- 一键复制某关布局
- 可点击状态热力图
- 卡死风险提示
- 关卡截图导出
- Node 脚本生成 `JokerSheepLevel.csv`

---

## 14. 建议目录结构

推荐放在项目根目录的工具区，不放进 Unity `Assets`。

```text
Tools/LevelEditorWeb/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    domain/
      levelTypes.ts
      enums.ts
      defaultLevel.ts
      levelClone.ts
    storage/
      fileSystemAccessStorage.ts
      importExportStorage.ts
    validation/
      validateLevel.ts
      validateAllLevels.ts
    board/
      boardConstants.ts
      boardLayoutFactory.ts
      boardClickability.ts
      boardGeometry.ts
    ui/
      LevelList.tsx
      LevelBasicPanel.tsx
      CardPoolPanel.tsx
      SpecialCardsPanel.tsx
      ItemsPanel.tsx
      ObjectivesPanel.tsx
      BoardEditor.tsx
      ValidationPanel.tsx
```

### 14.1 关键模块职责

`domain`

- 定义和 Unity JSON 一致的数据结构。
- 提供默认关卡生成和复制逻辑。

`storage`

- 负责读取、保存、删除 JSON。
- 屏蔽本地目录模式和导入导出模式的差异。

`validation`

- 复刻 Unity `LevelEditorValidator`。
- 所有 UI 只消费校验结果，不自己写校验规则。

`board`

- 存放布局坐标、默认矩阵、吸附、可点击计算。
- 这部分需要尽量接近 Unity `BoardService` 和 `LevelBoardLayoutEditor`。

`ui`

- 只负责界面和交互。
- 不直接写业务校验和坐标算法。

---

## 15. 实现顺序

建议按下面顺序落地：

1. 搭建 Vite + React + TypeScript 工具目录。
2. 定义 `LevelConfigData` TypeScript 类型。
3. 实现 JSON 导入导出。
4. 实现本地目录读取。
5. 实现关卡列表和选中编辑。
6. 实现基础字段、牌池、特殊牌、道具、目标表单。
7. 复刻校验器。
8. 实现 SVG 牌桌显示。
9. 实现槽位拖拽、吸附、右侧属性编辑。
10. 实现默认矩阵、补齐、同步 `TotalCards`。
11. 实现可点击状态预览。
12. 加入批量校验和保存前确认。

这个顺序可以保证每一步都有可验证结果，不会一开始就卡在复杂画布编辑上。

---

## 16. 风险点

### 16.1 JSON 字段名不能变

Unity `JsonUtility` 对字段名很敏感。

HTML 里保存时必须继续使用：

- `Id`
- `TitleKey`
- `DescriptionKey`
- `TotalCards`
- `TargetScore`
- `WinConditionMode`
- `PoolSuits`
- `PoolRanks`
- `SpecialWild`
- `SpecialMultiplier`
- `SpecialSuit`
- `ItemStorage`
- `ItemShuffle`
- `ItemAddWild`
  - `BoardLayout`
  - `Objectives`

`BoardLayout` 内部字段也必须保持 PascalCase：

- `X`
- `Y`
- `Layer`
- `Suit`
- `Rank`

### 16.2 枚举值必须对齐 Unity

尤其是：

- `LevelWinConditionMode`
- `HandType`
- `Suit`
- `Rank`

HTML 工具里不要自己重排枚举数字。

### 16.3 布局算法必须对齐运行时

最关键的是：

- 槽位数量不等于总牌数时，显式布局不生效。
- 可点击预览要用运行时遮挡规则。
- 默认矩阵要和 Unity 编辑器一致。

### 16.4 固定牌面不能破坏随机牌池语义

`BoardLayout[].Suit / Rank` 是“可选固定牌面”，不是替代 `PoolSuits / PoolRanks`。

HTML 工具需要明确区分：

- `PoolSuits / PoolRanks`：随机牌池，负责未固定牌面的候选范围。
- `BoardLayout[].Suit / Rank`：单槽位固定牌面，只有合法配置时才覆盖该槽位。
- `Suit = N, Rank = 0`：保持旧随机/特殊牌补位行为。

不要在保存时自动把所有槽位都固定成某张牌，除非用户明确操作。否则关卡会从“随机牌局”变成“完全固定牌局”。

### 16.5 文件写入权限

浏览器本地写文件必须依赖用户授权。

这不是代码 bug，而是浏览器安全限制。

### 16.6 不要让 Web 工具成为第二套导表标准

第一阶段 Web 工具只应该输出 JSON。

如果它同时输出 CSV、bytes、运行时资源，就会让项目出现多套构建真源。

---

## 17. 方案结论

推荐做 HTML/Web 关卡编辑器，但它的第一阶段边界必须清楚：

```text
HTML 只负责编辑 level_*.json。
Unity 继续负责生成 JokerSheepLevel.csv 和 JokerSheepLevel.bytes。
```

第一版重点应该放在：

- 更好用的关卡列表
- 更舒服的表单编辑
- 更强的布局可视化
- 更明确的校验反馈
- 更接近运行时的可点击预览

这样可以最大化提升调关效率，同时不破坏当前 Unity 工程已经稳定的正式数据链路。
