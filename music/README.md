# 星落成诗

为「星海之间」重新创作的原创器乐，取代旧曲《星海未眠》。

钢琴以 G–B♭–E♭ 的上行动机开篇，再由 D–C–B♭ 回答；6/8 拍的左手伴奏像湖面轻轻摇曳。中段短暂借用小下属和弦，之后旋律向高音区展开、弦乐进入，最后回归钢琴主题与宁静尾声。竖琴只在部分句尾回应。没有鼓组和人声。

- 长度：158.65 秒（约 2 分 39 秒）。
- 调性与拍号：降 E 大调，6/8，64 小节。
- 速度：以附点四分音符约 52 BPM 为中心，句末与尾声自然放慢。
- 音色：真实三角钢琴、中提琴组、大提琴组、竖琴的单音采样。
- 首尾：开头轻柔进入，最后一个主和弦充分衰减，循环时留出呼吸；不宣称无缝采样循环。
- 网站文件：160 kbps、44.1 kHz 立体声 MP3，3.17 MB。
- 成品检测：−19.42 LUFS，真峰值 −2.93 dBTP；详细数值见 `audio-checks.json`。

| 段落 | 开始时间 | 编排 |
| --- | --- | --- |
| 前奏 | 0:00 | 稀疏钢琴与主题片段 |
| 主题 | 0:10 | 完整旋律与变奏 |
| 间奏 | 0:47 | 留白、较暗的和声颜色 |
| 展开 | 1:07 | 高音区旋律、弦乐与低声部 |
| 回归 | 1:43 | 收拢配器，重现主题 |
| 尾声 | 2:21 | 放慢并落回主和弦 |

## 音色来源

旋律与编曲为本项目原创，录制乐器采样的作者另行署名：

- **Salamander Grand Piano V3** — Alexander Holm，[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)。来源：[sfzinstruments/SalamanderGrandPiano](https://github.com/sfzinstruments/SalamanderGrandPiano)，使用较轻的力度层；按照来源的校音参数移调、编排、处理与混音。
- **VSCO 2 Community Edition** — Sam Gossner、Simon Dalzell 录制，Elan Hickler / Soundemote 切分采样，[CC0](https://creativecommons.org/publicdomain/zero/1.0/)。来源：[sgossner/VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE)，使用中提琴组、大提琴组与竖琴。

完整署名随静态站点包含在 `dist/audio/CREDITS.txt`，页面左下角“配乐 · 星落成诗”可打开，MP3 内也带有音色署名。没有使用现成歌曲片段。

## 离线重新生成（可选）

站点运行仍只需要静态文件。只有重新演奏、生成音轨时，才需要 Python 3、NumPy、SciPy、FFmpeg，以及首次下载采样所需的网络连接：

```bash
python -m pip install numpy scipy
python tools/compose_soundtrack.py
```

- `tools/compose_soundtrack.py` 包含全部旋律、和声、配器、速度与混音参数。
- `samples.json` 固定采样来源提交和 Git blob 校验值，下载后检查完整性。采样只用于离线制作，不会在访问页面时下载。
- 结果保存在已忽略的 `music/generated/`：24-bit WAV 母带、MP3、两段 22 秒片段、乐谱事件和检测数据。
- 固定种子控制微小的演奏时间、力度与混响差异；相同依赖环境下可重复生成。
- 替换网站音乐时，将 `music/generated/starlight-on-water.mp3` 复制到 `dist/audio/`，并更新页面中的音频版本参数。

本次更新同步改用了新的音频文件名和 `music.js?v=2`，避免旧音乐被浏览器缓存。默认播放尝试、首次交互解锁、静音记忆和沉浸模式音乐开关继续使用原有逻辑。
