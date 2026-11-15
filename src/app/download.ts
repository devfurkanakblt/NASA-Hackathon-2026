/** Browser download of generated text (CSV) without a server. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** "Site04R_2026-11-15T0000Z" — safe for every file system. */
export const fileStem = (siteId: string, utc: string) => `${siteId}_${utc.slice(0, 16).replace(/:/g, '')}Z`.replace(/[^A-Za-z0-9_.-]+/g, '-')
