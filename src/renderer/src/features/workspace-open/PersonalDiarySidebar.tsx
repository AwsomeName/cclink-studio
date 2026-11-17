import { diaryPages, useDiaryNavigation } from './personal-diary-navigation'
export function PersonalDiarySidebar(): React.ReactElement {
  const { page, setPage } = useDiaryNavigation()
  return (
    <nav className="personal-diary-sidebar" aria-label="个人资料侧栏">
      {diaryPages.map((name) => (
        <button
          key={name}
          aria-current={page === name ? 'page' : undefined}
          onClick={() => setPage(name)}
        >
          {name}
        </button>
      ))}
      <p>
        原文原位保留
        <br />
        整理沿用原任务
        <br />
        Git 操作需主动发起
      </p>
    </nav>
  )
}
