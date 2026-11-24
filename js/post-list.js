(() => {
  function initPostList () {
    const loader = document.querySelector('.post-list-loader')
    if (!loader) return

    const link = loader.querySelector('a[rel="next"]')
    const moreLabel = link.textContent
    const section = loader.parentElement
    const timeline = section.querySelector('.article-sort')
    const list = timeline || section
    const listSelector = '#' + section.id + (timeline ? ' > .article-sort' : '')
    const seen = new Set(Array.from(list.querySelectorAll('[data-post-path]'), el => el.dataset.postPath))
    const loadedPages = new Set([window.location.origin + window.location.pathname])
    let loading = false
    let failed = false

    function stop () {
      window.removeEventListener('scroll', checkBottom)
      window.removeEventListener('resize', checkBottom)
      document.removeEventListener('pjax:send', stop)
    }

    function checkBottom () {
      if (!loading && !failed && loader.isConnected && loader.getBoundingClientRect().top <= window.innerHeight) {
        loadNext()
      }
    }

    async function loadNext () {
      if (loading) return
      loading = true
      failed = false
      link.textContent = loader.dataset.loading
      const url = link.href

      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error('Page request failed')
        const template = document.createElement('template')
        template.innerHTML = await response.text()
        if (!loader.isConnected) return

        const incoming = template.content.querySelector(listSelector)
        if (!incoming || !incoming.querySelector('[data-post-path]')) throw new Error('Missing posts')
        const next = template.content.querySelector('.post-list-loader a[rel="next"]')
        const nextUrl = next && new URL(next.getAttribute('href'), response.url).href
        if (nextUrl === url || loadedPages.has(nextUrl)) throw new Error('Repeated page')

        const fragment = document.createDocumentFragment()
        const years = list.querySelectorAll('.article-sort-item.year')
        let lastYear = years.length ? years[years.length - 1].textContent : ''
        let yearHeading
        for (const item of Array.from(incoming.children)) {
          if (item.classList.contains('year')) {
            yearHeading = item
          } else if (item.dataset.postPath && !seen.has(item.dataset.postPath)) {
            seen.add(item.dataset.postPath)
            if (yearHeading && yearHeading.textContent !== lastYear) {
              lastYear = yearHeading.textContent
              fragment.appendChild(yearHeading)
            }
            fragment.appendChild(item)
          } else if (item.matches('.recent-post-item.ad-height')) {
            fragment.appendChild(item)
          }
        }
        const added = Array.from(fragment.children)
        list.insertBefore(fragment, timeline ? null : loader)
        loadedPages.add(url)
        if (nextUrl) {
          link.href = nextUrl
          link.textContent = moreLabel
        } else {
          stop()
          loader.remove()
        }
        // A browser anchored to the mobile footer can scroll past the whole new batch.
        if (added.length && added[0].getBoundingClientRect().top < 0) {
          added[0].scrollIntoView({ block: 'end' })
        }
        document.dispatchEvent(new CustomEvent('posts:appended', { detail: added }))
      } catch (error) {
        failed = true
        link.textContent = loader.dataset.retry
      } finally {
        loading = false
      }
      if (loader.isConnected && !failed) requestAnimationFrame(checkBottom)
    }

    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      loadNext()
    })
    window.addEventListener('scroll', checkBottom, { passive: true })
    window.addEventListener('resize', checkBottom)
    document.addEventListener('pjax:send', stop)
    checkBottom()
  }

  initPostList()
  document.addEventListener('pjax:complete', initPostList)
})()
