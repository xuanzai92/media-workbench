// Browser-safe composition shared by the preview, Markdown projection and export.
const text = value => typeof value === 'string' ? value : ''

/** Keep images attached to matching headings; distribute unmatched images consistently. */
export function articleSections(article, images = []) {
  const sections = text(article).split(/\n(?=##\s)/).map(part => ({
    text: part,
    heading: /^##\s+(.+)/.exec(part)?.[1]?.trim() ?? '',
    images: [],
  }))
  images.forEach((image, index) => {
    if (!image) return
    let at = sections.findIndex(section => image.anchor && section.heading === image.anchor)
    if (at < 0) at = Math.min(sections.length - 1, Math.round(((index + 1) * sections.length) / (images.length + 1)))
    sections[at].images.push({ image, index })
  })
  return sections
}

function imageMarkdown(image, index, imageSrc) {
  const source = imageSrc(image, index)
  if (typeof source !== 'string' || !source.trim()) return ''
  // Preserve readable local filenames while preventing captions or URLs from breaking Markdown.
  const caption = text(image.caption).replace(/[\r\n]+/g, ' ').replace(/[\\[\]<>]/g, char => `\\${char}`)
  const href = source.replace(/[\s()<>"\\]/g, char => char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char))
  return `![${caption}](${href})`
}

/** Produce the full text and ready images in the same order as the selected format's preview. */
export function productionMarkdown(production, {
  imageSrc = image => image.src,
  includeImages = true,
  imageWrapper = markup => markup,
} = {}) {
  const images = Array.isArray(production?.images) ? production.images : []
  const render = (image, index) => {
    if (!includeImages) return ''
    const markup = imageMarkdown(image, index, imageSrc)
    return markup ? imageWrapper(markup, image, index) : ''
  }
  const body = production?.format === 'image_text'
    ? [text(production?.article).trim(), ...images.map((image, index) => image ? render(image, index) : '')].filter(Boolean).join('\n\n')
    : articleSections(production?.article, images).map(section => [
      section.text.trimEnd(),
      ...section.images.map(({ image, index }) => render(image, index)),
    ].filter(Boolean).join('\n\n')).join('\n\n').trim()
  const title = text(production?.title).replace(/[\r\n]+/g, ' ').trim()
  return `${title ? `# ${title}\n\n` : ''}${body}\n`
}

/** Completion of a job is separate from whether its requested deliverables are ready. */
export function productionReadiness(production) {
  const hasText = Boolean(text(production?.article).trim())
  const textDraft = hasText && (production?.textStatus === 'fallback'
    || (!production?.textStatus && production?.engine === 'local' && Boolean(production?.notice)))
  const textReady = hasText && !textDraft && production?.textStatus !== 'failed'
  const images = Array.isArray(production?.images) ? production.images : []
  const requested = Number.isFinite(production?.imageCount) ? Math.max(0, Math.floor(production.imageCount)) : 0
  const imagesTotal = Math.max(images.length, requested, production?.format === 'image_text' ? 1 : 0)
  const imagesDone = images.filter(image => image?.src && (!image.status || image.status === 'done')).length
  const imagesMissing = Math.max(0, imagesTotal - imagesDone)
  const busy = production?.status === 'running' || images.some(image => ['pending', 'running'].includes(image?.status))
  return { textReady, textDraft, imagesDone, imagesTotal, imagesMissing, busy, complete: textReady && !imagesMissing && !busy }
}
