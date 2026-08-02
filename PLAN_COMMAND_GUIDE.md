# /plan 命令使用指南

## 概述

`/plan` 是 Helpy 应用中的斜杠命令，用于快速创建和配置专注任务计划。通过简单的预设和自定义参数，您可以轻松开始专注工作。

## 基本用法

### 预设配置

Helpy 提供了三个常用的预设配置，您可以直接使用：

- **work** - 60 分钟工作会话

  ```
  /plan work
  ```

- **study** - 45 分钟学习会话

  ```
  /plan study
  ```

- **focus** - 25 分钟深度专注会话
  ```
  /plan focus
  ```

### 自定义配置

您可以自定义计划标题和时长：

- **自定义时长**：在预设后添加分钟数

  ```
  /plan work 90
  /plan study 60
  /plan focus 50
  ```

- **完全自定义**：输入自定义标题和时长
  ```
  /plan 阅读 45
  /plan 编写报告 120
  /plan 冥想 20
  ```

### 时长限制

- 最小时长：5 分钟
- 最大时长：240 分钟（4 小时）
- 默认时长：30 分钟

### 可选参数

`/plan` 现在支持更细粒度的命令参数：

```text
/plan work --goal "完成周报" --chunk 20 --break 5 --tags work,urgent
```

- `--goal`：覆盖预设目标
- `--chunk`：设置专注分块时长，范围 `5-60`
- `--break`：设置每段之间的休息时长，范围 `0-30`
- `--tags`：设置标签，多个值用逗号分隔

## 增强说明

本次增强主要围绕性能、容错、安全性和可复用性展开：

- 预设匹配改为“最长名称优先”，避免多词预设被短名称误匹配
- 预设加载增加缓存，减少重复 I/O 与 YAML 解析开销
- 输入清洗覆盖控制字符与危险符号，降低注入和格式污染风险
- 创建计划时统一做边界归一化，避免异常时长、分块和休息参数进入执行链路
- 错误统计与响应耗时指标纳入模块内性能记录，便于后续观测

## 新功能

### 智能休息分段

计划任务拆分现在可自动插入休息段：

- 支持普通休息与长休息策略
- 可按分块数量自动生成休息任务
- 休息任务会在统计和导出中单独标识

### 计划导出

新增计划导出能力，可导出为：

- JSON
- Markdown
- 纯文本

导出内容可按需包含任务明细和元数据，便于分享、归档或同步。

### 会话统计

新增会话级统计聚合：

- 专注总时长
- 休息总时长
- 已完成任务数
- 总任务数
- 开始/结束时间

### 生命周期状态管理

计划对象新增状态流转支持：

- `pending`
- `in_progress`
- `completed`
- `cancelled`

并支持单任务完成、整单完成和取消操作。

### 计划历史记录

所有创建的计划都会被自动保存到历史记录中。您可以通过 API 访问历史记录：

```
GET /api/focus-plans/history?limit=50
```

### 统计数据

查看您的专注统计数据：

```
GET /api/focus-plans/stats?days=30
```

返回数据包括：

- 总计划数量
- 总专注时间（分钟）
- 平均每次专注时长
- 按天统计数据

### 自定义模板

创建和管理常用的计划模板：

**创建模板**：

```
POST /api/focus-plans/templates
{
  "name": "Daily Review",
  "title": "每日回顾",
  "goal": "回顾今天的工作并规划明天",
  "durationMinutes": 30
}
```

**获取所有模板**：

```
GET /api/focus-plans/templates
```

**删除模板**：

```
DELETE /api/focus-plans/templates/{templateId}
```

模板现在还支持保存以下默认值：

- 默认分块时长
- 默认休息时长
- 标签
- 主题
- 图标

## 代码架构

### 核心组件

1. **Logger (logger.js)**
   - 统一的日志系统，支持多级日志（debug, info, warn, error）
   - 支持子日志器，方便模块级日志管理

2. **FocusPlanManager (focus-plan-manager.js)**
   - 专注计划管理器，处理所有计划相关的业务逻辑
   - 支持计划创建、历史记录管理、模板管理和统计计算
   - 数据持久化存储

3. **CommandHandler (chrome-extension/commands.js)**
   - 命令处理器，负责解析和执行用户斜杠命令
   - 代码重构为模块化结构，提升可维护性

4. **Plan Command Core (chrome-extension/shared/plan-command.js)**
   - 负责预设解析、输入清洗、任务拆分、模板处理、导出和性能指标
   - 集中处理计划生命周期和休息分段逻辑

5. **数据验证 (shared/schemas.js)**
   - 新增计划历史和模板的数据结构验证函数

### 主要改进

1. **性能优化**
   - 预设缓存减少重复解析开销
   - 性能指标记录支持响应时间与错误率跟踪
   - 预设和别名统一匹配，减少重复分支判断

2. **功能扩展**
   - 新增休息分段与长休息策略
   - 新增计划导出能力
   - 新增会话统计能力
   - 增强模板字段与生命周期管理

3. **安全与可用性**
   - 强化输入清洗与边界校验
   - 改进异常回退，确保始终生成合法计划对象
   - 更清晰的同步失败与本地回退行为

4. **测试覆盖**
   - 扩展 `plan-command` 单元测试，覆盖 48 个用例
   - 回归验证 `FocusPlanManager` 与 `CommandHandler`
   - 补充多词预设、休息任务、导出、统计、生命周期等场景

## 示例

### 创建简单计划

```javascript
// 使用预设
const plan = focusPlanManager.parsePlanArguments('work');

// 创建并保存计划
const createdPlan = focusPlanManager.createPlan(plan);
focusPlanManager.addToHistory(createdPlan);
```

### 使用自定义模板

```javascript
// 创建模板
const template = focusPlanManager.createTemplate({
  name: 'Morning Planning',
  title: '晨间规划',
  goal: '规划一天的任务',
  durationMinutes: 30,
});

// 使用模板创建计划
const planFromTemplate = focusPlanManager.createPlan({
  title: template.title,
  goal: template.goal,
  durationMinutes: template.durationMinutes,
});
```

### 查看统计数据

```javascript
// 查看过去 30 天的统计
const stats = focusPlanManager.getStatistics(30);
console.log(`您已创建 ${stats.totalPlans} 个计划`);
console.log(`总计 ${stats.totalMinutes} 分钟的专注时间`);
console.log(`平均每次专注 ${stats.averageDuration} 分钟`);
```

## 测试

运行所有测试：

```bash
npm test
```

运行代码质量检查：

```bash
npm run lint
```

格式化代码：

```bash
npm run format
```
