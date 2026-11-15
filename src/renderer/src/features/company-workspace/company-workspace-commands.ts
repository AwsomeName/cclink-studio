import type { Command } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { openBoundCompany } from '../workspace-open/fixed-spaces-store'
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
  if (useUIStore.getState().agentPanelMode === 'center')
    useUIStore.getState().setAgentPanelMode('right', 'user')
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
/** Top-level shortcuts use the fixed company; in-page/deep links retain explicit scope. */
export async function enterCompanyWorkspace(section: CompanySection = 'overview'): Promise<void> {
  if (await openBoundCompany(section)) openCompanyWorkspace(section)
}

export function createCompanyWorkspaceCommands(): Command[] {
  return companySections.map((section) => ({
    id: 'company.' + section.id,
    label: '打开' + section.label,
    category: '公司',
    risk: 'read',
    action: () => enterCompanyWorkspace(section.id),
  }))
}
