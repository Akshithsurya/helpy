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

## 新功能

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

4. **数据验证 (shared/schemas.js)**
   - 新增计划历史和模板的数据结构验证函数

### 主要改进

1. **代码优化**
   - 将计划管理逻辑从 main.js 中解耦到 FocusPlanManager
   - 添加完整的 JSDoc 注释，提高代码可读性
   - 统一的错误处理和日志记录
   - 遵循单一职责原则

2. **功能扩展**
   - 新增历史记录功能，保存用户的所有专注计划
   - 新增统计功能，分析用户的专注习惯
   - 新增模板功能，便于重复使用常用配置
   - 新增 REST API 支持

3. **测试覆盖**
   - 完整的 FocusPlanManager 单元测试
   - 更新的 CommandHandler 测试，包括 parsePlanArguments 方法测试
   - 新增 handlePlanCommand 的 API 集成测试

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
