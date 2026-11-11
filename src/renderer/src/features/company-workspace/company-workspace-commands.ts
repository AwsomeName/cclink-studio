import type { Command } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { openDefaultWorkspace } from '../workspace-open/workspace-open-controller'
export type CompanySection = 'overview' | 'projects' | 'finance' | 'operations' | 'knowledge'
export const companySections: Array<{ id: CompanySection; label: string }> = [
  { id: 'overview', label: '公司总览' },
  { id: 'projects', label: '业务项目' },
  { id: 'finance', label: '财务' },
  { id: 'operations', label: '运营' },
  { id: 'knowledge', label: '资料与会话' },
]
export function openCompanyWorkspace(
  section: CompanySection = 'overview',
  businessId?: string,
  month?: string,
): void {
  const workspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  if (workspaceRef.kind !== 'local') throw new Error('请先打开本地工作空间')
  const previous = useTabStore
    .getState()
    .tabs.find(
      (tab) =>
        tab.type === 'company-workspace' &&
        tab.workspaceRef?.kind === 'local' &&
        tab.workspaceRef.path === workspaceRef.path,
    )
  const selectedMonth = month ?? previous?.companyWorkspace?.month
  useUIStore.getState().showPanel('company-workspace')
  if (section === 'finance') {
    useTabStore.getState().openTab({
      type: 'company-accounts',
      title: '公司账目',
      icon: '账',
      workspaceRef,
      companyAccounts: selectedMonth ? { month: selectedMonth, projectId: null } : undefined,
    })
  } else {
    useTabStore.getState().openTab({
      type: 'company-workspace',
      title: '公司经营',
      icon: '司',
      workspaceRef,
      companyWorkspace: { section, businessId: businessId ?? null, month: selectedMonth },
    })
  }
}
/** 公司入口为未归档提供默认资料归属，页内导航仍使用当前工作空间。 */
export async function enterCompanyWorkspace(section: CompanySection = 'overview'): Promise<void> {
  if (useWorkspaceStore.getState().activeWorkspaceRef.kind === 'global') {
    const opened = await openDefaultWorkspace()
    const active = useWorkspaceStore.getState().activeWorkspaceRef
    if (!opened || active.kind !== 'local' || active.path !== opened.path) {
      throw new Error('工作空间已发生变化，请重新打开公司经营')
    }
  }
  openCompanyWorkspace(section)
}

export function createCompanyWorkspaceCommands(): Command[] {
  return companySections.map((section) => ({
    id: 'company.' + section.id,
    label: '打开' + section.label,
    category: '公司',
    risk: 'read',
    enabled: () => ({
      enabled: useWorkspaceStore.getState().activeWorkspaceRef.kind !== 'remote',
      reason: '公司视图仅支持本地工作空间',
    }),
    action: () => enterCompanyWorkspace(section.id),
  }))
}
