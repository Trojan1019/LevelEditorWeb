/** LevelBoardLayoutEditor + BoardService alignment */
export const SOURCE_CARD_WIDTH = 42;
export const SOURCE_CARD_HEIGHT = 66;
// Web editor UX default. (Unity editor defaults are 21/19, but this tool uses 20 per requirement.)
export const DEFAULT_SNAP_STEP_X = 20;
export const DEFAULT_SNAP_STEP_Y = 20;
export const SNAP_ORIGIN_X = 0;
/** 棋盘预览与吸附的 Y 基准线（数据坐标）；网格与「横向参考线」画在此 Y 上 */
export const SNAP_ORIGIN_Y = -40;

/** BoardService occlusion (clickability) */
export const OCCLUSION_WIDTH = 42;
export const OCCLUSION_HEIGHT = 42 * 1.57;
export const MIN_CLICKABLE_VISIBLE_AREA_RATIO = 0.7;
