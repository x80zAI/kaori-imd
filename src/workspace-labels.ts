import type { WorkspaceView } from './workspace-navigation';

export const CHINESE_DESKS: Record<Exclude<WorkspaceView, 'story'>, { navLabel: string; title: string; description: string }> = {
  home: { navLabel: '仪表盘', title: '仪表盘', description: '' },
  receipt: { navLabel: '交易凭证', title: '交易凭证', description: '输入交易哈希，查看 IMD 转账记录。' },
  approvals: { navLabel: '授权检查', title: '授权检查', description: '查看应用使用你账户中 IMD 的权限。' },
  staking: { navLabel: '质押', title: 'IMD 质押', description: '通过官方金库存入和赎回 IMD。' },
  network: { navLabel: '网络', title: '网络工作台', description: '关注智能体、任务和预言机结果。' },
  archive: { navLabel: '我的存档', title: '我的存档', description: '重新查看已保存的交易凭证和笔记。' },
};
