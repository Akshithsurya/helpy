import React, { useState, useEffect, useCallback } from 'react';
import {
  listShortcuts,
  removeShortcut,
  useShortcut,
  parsePlanArguments,
  createPlanConfig
} from '../../chrome-extension/shared/plan-command';
import { FocusPlan } from '../types';

interface Shortcut {
  id: string;
  name: string;
  command: string;
  description?: string;
  createdAt: number;
  usageCount: number;
}

interface PlanShortcutsProps {
  onSelectShortcut?: (plan: FocusPlan) => void;
}

const PlanShortcuts: React.FC<PlanShortcutsProps> = ({ onSelectShortcut }) => {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);

  // Load shortcuts on mount
  useEffect(() => {
    refreshShortcuts();
  }, []);

  const refreshShortcuts = useCallback(() => {
    setShortcuts(listShortcuts());
  }, []);

  const handleSelect = useCallback((shortcut: Shortcut) => {
    useShortcut(shortcut.id);
    const parsed = parsePlanArguments(shortcut.command);
    const plan = createPlanConfig(shortcut.command);
    onSelectShortcut?.(plan);
    refreshShortcuts();
  }, [onSelectShortcut, refreshShortcuts]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('确定要删除这个快捷方式吗？')) {
      removeShortcut(id);
      refreshShortcuts();
    }
  }, [refreshShortcuts]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (shortcuts.length === 0) {
    return (
      <div className="plan-shortcuts p-6 text-center text-gray-500">
        <div className="text-4xl mb-3">[快捷方式]</div>
        <p>还没有保存任何快捷方式</p>
        <p className="text-sm mt-1">在创建计划时点击"保存为快捷方式"来添加</p>
      </div>
    );
  }

  return (
    <div className="plan-shortcuts">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>[快捷方式]</span> 我的快捷方式
      </h3>
      <div className="space-y-3">
        {shortcuts
          .sort((a, b) => b.usageCount - a.usageCount)
          .map((shortcut) => (
            <div
              key={shortcut.id}
              onClick={() => handleSelect(shortcut)}
              className="p-4 border rounded-lg hover:shadow-md cursor-pointer transition-all group bg-white"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-medium text-gray-800">{shortcut.name}</h4>
                  {shortcut.description && (
                    <p className="text-sm text-gray-500">{shortcut.description}</p>
                  )}
                </div>
                <button
                  onClick={(e) => handleDelete(e, shortcut.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-700 transition-opacity"
                  title="删除"
                >
                  [删除]
                </button>
              </div>
              <div className="text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded mb-2">
                {shortcut.command}
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>创建于: {formatDate(shortcut.createdAt)}</span>
                <span>使用: {shortcut.usageCount} 次</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};

export default PlanShortcuts;
