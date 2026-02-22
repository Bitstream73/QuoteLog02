// Category Detail Page

function buildCategoryQuoteHtml(q, options = {}) {
  const mapped = {
    id: q.id,
    text: q.text,
    context: q.context,
    person_name: q.personName,
    person_id: q.personId,
    photo_url: q.photoUrl || '',
    person_category_context: q.personCategoryContext || '',
    article_id: q.articleId || '',
    article_title: q.articleTitle || '',
    article_url: q.articleUrl || '',
    source_domain: q.primarySourceDomain || '',
    source_name: q.primarySourceName || '',
    quote_datetime: q.quoteDateTime || q.articlePublishedAt || q.createdAt || '',
    importants_count: q.importantsCount || q.importants_count || q.voteScore || 0,
    share_count: q.shareCount || q.share_count || 0,
    view_count: q.viewCount || q.view_count || 0,
    is_visible: q.isVisible,
    fact_check_verdict: q.factCheckVerdict || null,
  };
  const isImp = typeof _importantStatuses !== 'undefined' ? (_importantStatuses[`quote:${q.id}`] || false) : false;
  return buildQuoteBlockHtml(mapped, isImp, options);
}

let _categorySort = 'date';

async function renderCategory(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading category...</div>';

  try {
    const [catData, quotesData] = await Promise.all([
      API.get(`/categories/${id}`),
      API.get(`/categories/${id}/quotes?limit=50&sort=${_categorySort}`),
    ]);

    if (!catData.category) {
      content.innerHTML = `
        <div class="empty-state">
          <h3>Category not found</h3>
          <p><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">Back to home</a></p>
        </div>
      `;
      return;
    }

    const cat = catData.category;
    const topics = catData.topics || [];

    if (typeof updatePageMeta === 'function') {
      updatePageMeta(`${cat.name} - Quotes`, `${catData.quoteCount} quotes in the ${cat.name} category`, `/category/${cat.id}`);
    }

    const catAvatarHtml = typeof buildCategoryAvatarHtml === 'function'
      ? buildCategoryAvatarHtml(cat.image_url, cat.icon_name, cat.name, 'sm')
      : '';

    let html = `
      ${typeof buildBackArrowHtml === 'function' ? buildBackArrowHtml() : ''}

      <div class="category-header" style="display:flex;align-items:center;gap:0.75rem">
        ${catAvatarHtml}
        <div>
          <h1 class="page-title" style="margin:0">${escapeHtml(cat.name)}</h1>
          <p class="page-subtitle" style="border-bottom:none;padding-bottom:0;margin:0">${catData.quoteCount} quote${catData.quoteCount !== 1 ? 's' : ''}</p>
        </div>
      </div>
    `;

    if (topics.length > 0) {
      html += `<div class="category-topics">
        <div class="category-topics-list">
          ${topics.map(t => `<span class="category-topic-chip" onclick="navigateTo('/topic/${t.id}')" style="cursor:pointer">${escapeHtml(t.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    // Sort controls
    html += `<div class="trending-quotes__sort">
      Sort by: <button class="sort-btn ${_categorySort === 'date' ? 'active' : ''}" data-sort="date" onclick="setCategorySort('date', '${cat.slug || cat.id}')">Date</button>
      <button class="sort-btn ${_categorySort === 'importance' ? 'active' : ''}" data-sort="importance" onclick="setCategorySort('importance', '${cat.slug || cat.id}')">Importance</button>
    </div>`;

    html += `<h2 style="margin:1rem 0;font-family:var(--font-headline);font-size:1.3rem">Quotes</h2>`;

    if (quotesData.quotes.length === 0) {
      html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No quotes found in this category.</p>';
    } else {
      const statusKeys = quotesData.quotes.map(q => `quote:${q.id}`);
      if (typeof fetchImportantStatuses === 'function') {
        await fetchImportantStatuses(statusKeys);
      }

      html += '<div id="category-quotes-list">';
      for (const q of quotesData.quotes) {
        html += buildCategoryQuoteHtml(q);
      }
      html += '</div>';

      if (quotesData.totalPages > 1) {
        html += `
          <div class="pagination">
            <span class="pagination-info">Page 1 of ${quotesData.totalPages}</span>
            <button class="page-btn" onclick="loadCategoryQuotesPage('${cat.slug || id}', 2)">Next &rarr;</button>
          </div>
        `;
      }
    }

    content.innerHTML = html;

    // Init swipe-to-go-back
    if (typeof initPageSwipe === 'function') initPageSwipe(content);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function setCategorySort(sort, id) {
  _categorySort = sort;
  renderCategory(id);
}

async function loadCategoryQuotesPage(categoryId, page) {
  try {
    const quotesData = await API.get(`/categories/${categoryId}/quotes?page=${page}&limit=50&sort=${_categorySort}`);

    if (typeof fetchImportantStatuses === 'function') {
      await fetchImportantStatuses(quotesData.quotes.map(q => `quote:${q.id}`));
    }

    const listEl = document.getElementById('category-quotes-list');
    if (!listEl) return;

    const container = listEl.parentElement;
    const existing = container.querySelectorAll('.quote-entry, .pagination');
    existing.forEach(el => el.remove());

    let html = '';
    for (const q of quotesData.quotes) {
      html += buildCategoryQuoteHtml(q);
    }

    html += '<div class="pagination">';
    if (page > 1) {
      html += `<button class="page-btn" onclick="loadCategoryQuotesPage('${categoryId}', ${page - 1})">&larr; Previous</button>`;
    }
    html += `<span class="pagination-info">Page ${page} of ${quotesData.totalPages}</span>`;
    if (page < quotesData.totalPages) {
      html += `<button class="page-btn" onclick="loadCategoryQuotesPage('${categoryId}', ${page + 1})">Next &rarr;</button>`;
    }
    html += '</div>';

    container.insertAdjacentHTML('beforeend', html);
  } catch (err) {
    console.error('Error loading category quotes page:', err);
  }
}
