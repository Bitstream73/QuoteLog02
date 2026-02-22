// Topic Detail Page

function buildTopicQuoteHtml(q, options = {}) {
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
    importants_count: q.importantsCount || q.importants_count || 0,
    share_count: q.shareCount || q.share_count || 0,
    view_count: q.viewCount || q.view_count || 0,
    is_visible: q.isVisible,
    fact_check_verdict: q.factCheckVerdict || null,
  };
  const isImp = typeof _importantStatuses !== 'undefined' ? (_importantStatuses[`quote:${q.id}`] || false) : false;
  return buildQuoteBlockHtml(mapped, isImp, options);
}

let _topicSort = 'date';

async function renderTopic(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading topic...</div>';

  try {
    const [topicData, quotesData] = await Promise.all([
      API.get(`/topics/${id}`),
      API.get(`/topics/${id}/quotes?limit=50&sort=${_topicSort}`),
    ]);

    if (!topicData.topic) {
      content.innerHTML = `
        <div class="empty-state">
          <h3>Topic not found</h3>
          <p><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">Back to home</a></p>
        </div>
      `;
      return;
    }

    const topic = topicData.topic;
    const categories = topicData.categories || [];

    if (typeof updatePageMeta === 'function') {
      updatePageMeta(`${topic.name} - Quotes`, `${topicData.quoteCount} quotes about ${topic.name}`, `/topic/${topic.slug || topic.id}`);
    }

    let html = `
      ${typeof buildBackArrowHtml === 'function' ? buildBackArrowHtml() : ''}

      <div class="topic-header">
        <h1 class="page-title">${escapeHtml(topic.name)}</h1>
        ${topic.description ? `<p class="page-subtitle" style="border-bottom:none;padding-bottom:0;margin-bottom:0.5rem">${escapeHtml(topic.description)}</p>` : ''}
        <p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted);margin:0">${topicData.quoteCount} quote${topicData.quoteCount !== 1 ? 's' : ''}</p>
      </div>
    `;

    if (categories.length > 0) {
      html += `<div class="category-topics" style="margin-bottom:1rem">
        <div class="category-topics-list">
          ${categories.map(c => `<span class="category-topic-chip" onclick="navigateTo('/category/${c.slug || c.id}')" style="cursor:pointer">${escapeHtml(c.name)}</span>`).join('')}
        </div>
      </div>`;
    }

    // Sort controls
    html += `<div class="trending-quotes__sort">
      Sort by: <button class="sort-btn ${_topicSort === 'date' ? 'active' : ''}" data-sort="date" onclick="setTopicSort('date', '${topic.slug || topic.id}')">Date</button>
      <button class="sort-btn ${_topicSort === 'importance' ? 'active' : ''}" data-sort="importance" onclick="setTopicSort('importance', '${topic.slug || topic.id}')">Importance</button>
    </div>`;

    html += `<h2 style="margin:1rem 0;font-family:var(--font-headline);font-size:1.3rem">Quotes</h2>`;

    if (quotesData.quotes.length === 0) {
      html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No quotes found for this topic.</p>';
    } else {
      const statusKeys = quotesData.quotes.map(q => `quote:${q.id}`);
      if (typeof fetchImportantStatuses === 'function') {
        await fetchImportantStatuses(statusKeys);
      }

      html += '<div id="topic-quotes-list">';
      for (const q of quotesData.quotes) {
        html += buildTopicQuoteHtml(q);
      }
      html += '</div>';

      if (quotesData.totalPages > 1) {
        html += `
          <div class="pagination">
            <span class="pagination-info">Page 1 of ${quotesData.totalPages}</span>
            <button class="page-btn" onclick="loadTopicQuotesPage('${topic.slug || topic.id}', 2)">Next &rarr;</button>
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

function setTopicSort(sort, id) {
  _topicSort = sort;
  renderTopic(id);
}

async function loadTopicQuotesPage(topicId, page) {
  try {
    const quotesData = await API.get(`/topics/${topicId}/quotes?page=${page}&limit=50&sort=${_topicSort}`);

    if (typeof fetchImportantStatuses === 'function') {
      await fetchImportantStatuses(quotesData.quotes.map(q => `quote:${q.id}`));
    }

    const listEl = document.getElementById('topic-quotes-list');
    if (!listEl) return;

    const container = listEl.parentElement;
    const existing = container.querySelectorAll('.quote-entry, .pagination');
    existing.forEach(el => el.remove());

    let html = '';
    for (const q of quotesData.quotes) {
      html += buildTopicQuoteHtml(q);
    }

    html += '<div class="pagination">';
    if (page > 1) {
      html += `<button class="page-btn" onclick="loadTopicQuotesPage('${topicId}', ${page - 1})">&larr; Previous</button>`;
    }
    html += `<span class="pagination-info">Page ${page} of ${quotesData.totalPages}</span>`;
    if (page < quotesData.totalPages) {
      html += `<button class="page-btn" onclick="loadTopicQuotesPage('${topicId}', ${page + 1})">Next &rarr;</button>`;
    }
    html += '</div>';

    container.insertAdjacentHTML('beforeend', html);
  } catch (err) {
    console.error('Error loading topic quotes page:', err);
  }
}
