import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const BASE_URL = 'https://ml-market-backend-redaction.azurewebsites.net'
const DECISION_PAGE_SIZE = 25
const MOBILE_BREAKPOINT = 1100
const PIPELINE_STEPS = ['Ingest', 'Extract', 'Classify', 'Analyze', 'Redact']
const UNCLASSIFIED_PII_LABEL = 'Unclassified'
const HOVER_ZOOM_FACTOR = 4
const HOVER_PREVIEW_SIZE = 180
const HOVER_PREVIEW_GAP = 16
const EMAIL_PDF_URL = new URL('../email.pdf', import.meta.url).href
const AGENT_NOTES_PDF_URL = new URL('../agent_notes.pdf', import.meta.url).href
const HIRE_PURCHASE_PDF_URL = new URL('../hire_purchase.pdf', import.meta.url).href
const PASSPORT_PDF_URL = new URL('../passport.pdf', import.meta.url).href
const US_TAX_PDF_URL = new URL('../us-tax-1040.pdf', import.meta.url).href
const ORIGINAL_SAMPLE_IMG_URL = new URL('../01_original.png', import.meta.url).href
const PREPROCESSED_SAMPLE_IMG_URL = new URL('../02_preprocessed.png', import.meta.url).href
const OCR_BOXES_SAMPLE_IMG_URL = new URL('../03_ocr_boxes.png', import.meta.url).href
const FIRSTSOURCE_LOGO_URL = new URL('../Firstsource-logo.png', import.meta.url).href
const SAMPLE_DOCS = [
  {
    title: 'Hire Purchase',
    description:
      'Financial agreements between hirer and dealer, including vehicle details, payment schedules, and contractual terms.',
    previewUrl: HIRE_PURCHASE_PDF_URL,
  },
  {
    title: 'U.S Tax (1040)',
    description:
      'IRS tax return forms with income details, Social Security numbers, employer information, and filing status.',
    previewUrl: US_TAX_PDF_URL,
  },
  {
    title: 'Passport',
    description:
      'Government-issued identity documents containing personal details, photographs, and machine-readable zone (MRZ) data.',
    previewUrl: PASSPORT_PDF_URL,
  },
  {
    title: 'Agent Notes',
    description: 'Internal CRM records capturing customer interactions, call summaries, case outcomes, and servicing history.',
    previewUrl: AGENT_NOTES_PDF_URL,
  },
  {
    title: 'Email',
    description:
      'Corporate email correspondence containing customer details and internal communications between departments.',
    previewUrl: EMAIL_PDF_URL,
  },
]

const PREPROCESS_PREVIEWS = [
  { label: 'Original Image', src: ORIGINAL_SAMPLE_IMG_URL },
  { label: 'Preprocessed Image', src: PREPROCESSED_SAMPLE_IMG_URL },
  { label: 'OCR Bounding Boxes', src: OCR_BOXES_SAMPLE_IMG_URL },
]
const SAMPLE_UPLOAD_OPTIONS = [
  { name: 'hire_purchase.pdf', url: HIRE_PURCHASE_PDF_URL },
  { name: 'us-tax-1040.pdf', url: US_TAX_PDF_URL },
]
const SYSTEM_FLOW_STEPS = [
  {
    index: 1,
    title: 'PRE-PROCESSING',
    description: 'PDF is converted to images, after which uneven lighting is removed and local contrast is enhanced.',
    targetId: 'preprocessing-section',
  },
  {
    index: 2,
    title: 'OCR BOUNDING BOXES',
    description: 'PaddleOCR runs on the preprocessed image to detect and localise every text region. Bounding-box coordinates are mapped back to the original image.',
    targetId: 'preprocessing-section',
  },
  {
    index: 3,
    title: 'DATA SUBJECT IDENTIFICATION',
    description:
      "Identifies the Data Subject - the customer whose data is being requested, distinguishing the Data Subject's personal data from third-party data.",
    targetId: 'data-subject-section',
  },
  {
    index: 4,
    title: 'CLASSIFICATION AGENT',
    description:
      "It categorises each page into one of five types: Email, Agent Notes, Hire Purchase, Government ID, or U.S. Tax. Unrecognised documents default to a conservative 'Unknown' classification.",
    targetId: 'classification-section',
    chips: ['Hire Purchase', 'U.S. Tax', 'Passport', 'Email', 'Agent Notes', 'Unknown'],
  },
  {
    index: 5,
    title: 'REDACTION DECISION ENGINE',
    description:
      'The agent receives the full page context, the Data Subject identity from Step 3, and document-type-specific rules to determine whether each field should be kept or redacted.',
    targetId: 'decision-engine-section',
    rules: [
      { label: 'KEEP', tone: 'keep', text: 'Data Subject name, financial information, account references, generic labels and boilerplate text.' },
      { label: 'REDACT', tone: 'redact', text: 'Third-party personal data, staff names, relationship descriptors, health information and legal privileged content.' },
      { label: 'PARTIAL', tone: 'partial', text: 'When a text region contains mixed keep/redact content, only the sensitive substring is masked.' },
    ],
  },
  {
    index: 6,
    title: 'OUTPUT',
    description: 'Each processed page produces a structured JSON output containing:',
    targetId: 'output-section',
    outputs: [
      { label: 'Document Classification', text: 'Type, confidence score, reasoning, and key words.' },
      { label: 'Per-Box Decisions', text: 'For every text region: redact/keep verdict, PII type, confidence, and audit-ready justification.' },
    ],
  },
]

const getConfidenceTone = (confidencePct) => {
  if (confidencePct >= 85) return 'high'
  if (confidencePct >= 65) return 'medium'
  return 'low'
}

const apiUrl = (path) => `${BASE_URL}${path}`

const getStepIndexFromAgent = (agentName = '') => {
  const value = agentName.toLowerCase()

  if (value.includes('decision') || value.includes('applicat')) return 4
  if (
    value.includes('redaction') ||
    value.includes('email') ||
    value.includes('agent notes') ||
    value.includes('hire purchase') ||
    value.includes('government') ||
    value.includes('tax') ||
    value.includes('general')
  ) {
    return 3
  }
  if (value.includes('classif')) return 2
  if (value.includes('ocr') || value.includes('pre-scan') || value.includes('preprocess') || value.includes('subject')) return 1
  if (value.includes('pdf') || value.includes('pipeline') || value.includes('orchestrat')) return 0

  return 0
}

function App() {
  const statusEventSourceRef = useRef(null)
  const completionWatcherRef = useRef(null)
  const activeJobIdRef = useRef('')
  const currentPageRef = useRef(1)
  const uploadInputRef = useRef(null)

  const [uiState, setUiState] = useState('idle')
  const [route, setRoute] = useState(window.location.pathname === '/demo' ? 'demo' : 'landing')
  const [errorMessage, setErrorMessage] = useState('')
  const [expandedFlowStepIndex, setExpandedFlowStepIndex] = useState(null)
  const [uploadedName, setUploadedName] = useState('')
  const [uploadedFile, setUploadedFile] = useState(null)
  const [jobId, setJobId] = useState('')
  const [landingPdfPreview, setLandingPdfPreview] = useState(null)
  const [landingImagePreview, setLandingImagePreview] = useState(null)
  const [activePanel, setActivePanel] = useState('original')
  const [compactLayout, setCompactLayout] = useState(window.innerWidth <= MOBILE_BREAKPOINT)

  const [processingEvents, setProcessingEvents] = useState([])
  const [totalPages, setTotalPages] = useState(1)
  const [completedRedactedPages, setCompletedRedactedPages] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [originalImageReady, setOriginalImageReady] = useState(false)
  const [redactedImageReady, setRedactedImageReady] = useState(false)
  const [imageRefreshByPage, setImageRefreshByPage] = useState({})
  const [pageReadyNotice, setPageReadyNotice] = useState('')

  const [livePages, setLivePages] = useState({})
  const [decisionView, setDecisionView] = useState('all')
  const [searchValue, setSearchValue] = useState('')
  const [visibleCount, setVisibleCount] = useState(DECISION_PAGE_SIZE)
  const [selectedType, setSelectedType] = useState(null)
  const [originalZoom, setOriginalZoom] = useState(1)
  const [redactedZoom, setRedactedZoom] = useState(1)
  const [selectedBoxId, setSelectedBoxId] = useState(null)
  const [hoverFocus, setHoverFocus] = useState({
    active: false,
    xPct: 50,
    yPct: 50,
    xPx: 0,
    yPx: 0,
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  })

  useEffect(() => {
    const onResize = () => setCompactLayout(window.innerWidth <= MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    return () => {
      statusEventSourceRef.current?.close()
      statusEventSourceRef.current = null
      if (completionWatcherRef.current) {
        window.clearInterval(completionWatcherRef.current)
        completionWatcherRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname === '/demo' ? 'demo' : 'landing')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const closeStatusStream = () => {
    statusEventSourceRef.current?.close()
    statusEventSourceRef.current = null
  }

  const stopCompletionWatcher = () => {
    if (completionWatcherRef.current) {
      window.clearInterval(completionWatcherRef.current)
      completionWatcherRef.current = null
    }
  }

  const fetchResults = async (nextJobId) => {
    const response = await fetch(apiUrl(`/api/results/${nextJobId}`))
    if (!response.ok) {
      throw new Error(`Results fetch failed (${response.status})`)
    }
    return response.json()
  }

  const applyResults = (data, markAllComplete = false) => {
    if (!data) return
    const mergedPages = {}
    const pageNumbers = []
    ;(data.pages ?? []).forEach((page) => {
      if (typeof page.page_number === 'number') {
        mergedPages[page.page_number] = page
        pageNumbers.push(page.page_number)
      }
    })
    setLivePages((prev) => ({ ...prev, ...mergedPages }))
    if (pageNumbers.length > 0) {
      setImageRefreshByPage((prev) => {
        const next = { ...prev }
        pageNumbers.forEach((pageNumber) => {
          next[pageNumber] = (next[pageNumber] ?? 0) + 1
        })
        return next
      })
    }
    if (typeof data.total_pages === 'number' && data.total_pages > 0) {
      setTotalPages(data.total_pages)
      if (markAllComplete || data.status === 'complete') {
        setCompletedRedactedPages(Array.from({ length: data.total_pages }, (_, idx) => idx + 1))
      } else if (pageNumbers.length > 0) {
        setCompletedRedactedPages((prev) => [...new Set([...prev, ...pageNumbers])].sort((a, b) => a - b))
      }
    } else if (pageNumbers.length > 0) {
      setCompletedRedactedPages((prev) => [...new Set([...prev, ...pageNumbers])].sort((a, b) => a - b))
    }
  }

  const startCompletionWatcher = (nextJobId) => {
    stopCompletionWatcher()
    completionWatcherRef.current = window.setInterval(async () => {
      try {
        const data = await fetchResults(nextJobId)
        if (activeJobIdRef.current !== nextJobId) return
        if (Array.isArray(data.pages) && data.pages.length > 0) {
          applyResults(data, false)
        } else if (typeof data.total_pages === 'number' && data.total_pages > 0) {
          setTotalPages(data.total_pages)
        }
        if (data.status === 'complete') {
          stopCompletionWatcher()
          closeStatusStream()
          setUiState('complete')
          applyResults(data, true)
        } else if (data.status === 'error') {
          stopCompletionWatcher()
          closeStatusStream()
          setUiState('error')
          setErrorMessage(data.error || 'Processing failed on backend.')
        }
      } catch {
        // keep watcher alive for transient network failures
      }
    }, 3000)
  }

  const openStatusStream = (nextJobId) => {
    closeStatusStream()
    const es = new EventSource(apiUrl(`/api/status/${nextJobId}`))
    statusEventSourceRef.current = es

    es.onmessage = (event) => {
      if (activeJobIdRef.current !== nextJobId) return
      if (!event.data) return
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      setProcessingEvents((prev) => [
        ...prev,
        {
          ...payload,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        },
      ])

      if (typeof payload.total_pages === 'number' && payload.total_pages > 0) {
        setTotalPages(payload.total_pages)
      }

      if (payload.type === 'page_complete' && typeof payload.page === 'number') {
        setCompletedRedactedPages((prev) => {
          if (prev.includes(payload.page)) return prev
          return [...prev, payload.page].sort((a, b) => a - b)
        })
        setLivePages((prev) => ({
          ...prev,
          [payload.page]: {
            page_number: payload.page,
            classification: payload.classification ?? null,
            decisions: payload.decisions ?? [],
            redacted_count: payload.redacted_count ?? 0,
            total_boxes: payload.total_boxes ?? 0,
            llm_usage: payload.llm_usage ?? null,
            page_timing: payload.page_timing ?? null,
          },
        }))
        if (payload.page === currentPageRef.current) {
          setRedactedImageReady(false)
        } else {
          setPageReadyNotice(`Page ${payload.page} redaction analysis is ready to view.`)
        }
        setImageRefreshByPage((prev) => ({
          ...prev,
          [payload.page]: (prev[payload.page] ?? 0) + 1,
        }))
      }

      if (payload.type === 'complete') {
        setUiState('complete')
        stopCompletionWatcher()
        closeStatusStream()
        fetchResults(nextJobId)
          .then((data) => {
            if (activeJobIdRef.current !== nextJobId) return
            applyResults(data)
          })
          .catch(() => {})
      }

      if (payload.type === 'error') {
        setUiState('error')
        setErrorMessage(payload.message || 'Processing failed on backend.')
        stopCompletionWatcher()
        closeStatusStream()
      }
    }

    es.onerror = () => {
      // EventSource can reconnect internally. Keep stream-driven flow.
    }
  }

  const selectedPageData = livePages[currentPage] ?? null
  const analysisReady = Boolean(selectedPageData) || uiState === 'complete'

  const decisions = useMemo(
    () =>
      (selectedPageData?.decisions ?? []).map((item) => ({
        id: `${currentPage}-${item.box_id}`,
        boxId: item.box_id,
        redact: item.redact,
        partial: item.partial,
        decision: item.partial ? 'PARTIAL' : item.redact ? 'REDACT' : 'KEEP',
        category: item.pii_type ?? (item.is_sensitive ? 'Sensitive' : 'General'),
        piiType: item.pii_type,
        dataOwner: item.data_owner ?? 'Unknown',
        text: item.text ?? '',
        reason: item.reason ?? '',
        confidence: item.confidence ?? 0,
        bbox: item.bbox ?? null,
        page: currentPage,
      })),
    [currentPage, selectedPageData],
  )

  const pageClassification = selectedPageData?.classification ?? null
  const classificationConfidence = Math.round((pageClassification?.confidence ?? 0) * 100)
  const confidenceTone = getConfidenceTone(classificationConfidence)

  const filteredDecisions = useMemo(() => {
    return decisions.filter((item) => {
      const matchesView = decisionView === 'all' || (decisionView === 'redacted' ? item.redact : !item.redact)
      const normalized = searchValue.trim().toLowerCase()
      const matchesSearch =
        !normalized ||
        item.text.toLowerCase().includes(normalized) ||
        item.reason.toLowerCase().includes(normalized) ||
        item.category.toLowerCase().includes(normalized)
      return matchesView && matchesSearch
    })
  }, [decisions, decisionView, searchValue])

  const piiTypeSummary = useMemo(() => {
    const countsByType = new Map()
    filteredDecisions.forEach((item) => {
      const typeLabel = item.piiType ?? UNCLASSIFIED_PII_LABEL
      countsByType.set(typeLabel, (countsByType.get(typeLabel) ?? 0) + 1)
    })
    return Array.from(countsByType.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  }, [filteredDecisions])

  const selectedTypeDecisions = useMemo(
    () => (selectedType ? filteredDecisions.filter((item) => (item.piiType ?? UNCLASSIFIED_PII_LABEL) === selectedType) : []),
    [filteredDecisions, selectedType],
  )
  const visibleSelectedTypeDecisions = useMemo(
    () => selectedTypeDecisions.slice(0, visibleCount),
    [selectedTypeDecisions, visibleCount],
  )
  const totalFields = selectedPageData?.total_boxes ?? decisions.length
  const redactedCount = selectedPageData?.redacted_count ?? decisions.filter((item) => item.redact).length
  const keptCount = Math.max(0, totalFields - redactedCount)

  const currentProcessingPage = processingEvents.length > 0 ? processingEvents[processingEvents.length - 1].page || 1 : 1
  const hasCurrentPageRedacted = completedRedactedPages.includes(currentPage) || uiState === 'complete'
  const processingPageValue = Math.min(Math.max(1, currentProcessingPage), Math.max(1, totalPages))
  const processingPagePercent = Math.round((processingPageValue / Math.max(1, totalPages)) * 100)
  const agentTimeline = useMemo(
    () => processingEvents.filter((item) => item.type === 'agent_update' && item.agent).map((item) => item.agent),
    [processingEvents],
  )
  const visibleProcessAgents = useMemo(() => [...new Set(agentTimeline)], [agentTimeline])
  const currentProcessAgent = agentTimeline.length > 0 ? agentTimeline[agentTimeline.length - 1] : ''

  const currentPageImageVersion = imageRefreshByPage[currentPage] ?? 0
  const originalImageUrl = jobId ? `${apiUrl(`/api/pages/${jobId}/${currentPage}/original`)}?v=${currentPageImageVersion}` : ''
  const redactedImageUrl = jobId ? `${apiUrl(`/api/pages/${jobId}/${currentPage}/redacted`)}?v=${currentPageImageVersion}` : ''
  const currentStepIndex = useMemo(() => {
    for (let idx = processingEvents.length - 1; idx >= 0; idx -= 1) {
      const event = processingEvents[idx]
      if (event.type === 'complete') return 4
      if (event.type === 'page_complete') return 4
      if (event.type === 'agent_update') return getStepIndexFromAgent(event.agent)
    }
    return 0
  }, [processingEvents])

  useEffect(() => {
    setVisibleCount(DECISION_PAGE_SIZE)
  }, [decisionView, searchValue, selectedType])

  useEffect(() => {
    setSelectedType(null)
  }, [currentPage, jobId])

  useEffect(() => {
    if (!selectedType) return
    if (!piiTypeSummary.some((item) => item.type === selectedType)) {
      setSelectedType(null)
    }
  }, [piiTypeSummary, selectedType])

  useEffect(() => {
    setOriginalImageReady(false)
    setHoverFocus((prev) => ({ ...prev, active: false }))
  }, [jobId, currentPage])

  useEffect(() => {
    setRedactedImageReady(false)
    setHoverFocus((prev) => ({ ...prev, active: false }))
  }, [jobId, currentPage])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    if (pageReadyNotice.startsWith(`Page ${currentPage} `)) {
      setPageReadyNotice('')
    }
  }, [currentPage, pageReadyNotice])

  useEffect(() => {
    if (!pageReadyNotice) return undefined
    const timer = window.setTimeout(() => {
      setPageReadyNotice('')
    }, 10000)
    return () => window.clearTimeout(timer)
  }, [pageReadyNotice])

  const startUploadForFile = async (file) => {
    if (!file) return

    const name = file.name.toLowerCase()
    const isPdf = name.endsWith('.pdf')
    const isImage = file.type.startsWith('image/')

    setErrorMessage('')
    setUploadedName(file.name)
    setUploadedFile(file)

    if (!isPdf && !isImage) {
      setUiState('error')
      setErrorMessage('Unsupported file type. Please upload PDF or image.')
      return
    }

    try {
      const previousJobId = jobId
      closeStatusStream()
      stopCompletionWatcher()
      activeJobIdRef.current = ''
      setUiState('processing')
      setProcessingEvents([])
      setJobId('')
      setTotalPages(1)
      setCompletedRedactedPages([])
      setCurrentPage(1)
      setOriginalImageReady(false)
      setRedactedImageReady(false)
      setImageRefreshByPage({})
      setSelectedBoxId(null)
      setOriginalZoom(1)
      setRedactedZoom(1)
      setPageReadyNotice('')
      setLivePages({})

      if (previousJobId) {
        await fetch(apiUrl(`/api/jobs/${previousJobId}`), { method: 'DELETE' }).catch(() => {})
      }
      await fetch(apiUrl('/api/cleanup'), { method: 'POST' }).catch(() => {})

      const form = new FormData()
      form.append('file', file)

      const uploadResponse = await fetch(apiUrl('/api/upload'), {
        method: 'POST',
        body: form,
      })
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`)
      }

      const uploadData = await uploadResponse.json()
      const nextJobId = uploadData.job_id
      activeJobIdRef.current = nextJobId
      setJobId(nextJobId)
      setUploadedName(uploadData.filename ?? file.name)
      startCompletionWatcher(nextJobId)
      openStatusStream(nextJobId)
    } catch (error) {
      setUiState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed.')
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    await startUploadForFile(file)
    event.target.value = ''
  }

  const closeUploadDropdown = (event) => {
    const details = event.currentTarget.closest('details')
    if (details) {
      details.removeAttribute('open')
    }
  }

  const handleUploadFromDevice = (event) => {
    closeUploadDropdown(event)
    if (uiState === 'processing') return
    uploadInputRef.current?.click()
  }

  const handleUploadSample = async (event, sampleName, sampleUrl) => {
    closeUploadDropdown(event)
    if (uiState === 'processing') return

    try {
      const response = await fetch(sampleUrl)
      if (!response.ok) {
        throw new Error(`Could not load sample file (${response.status})`)
      }
      const blob = await response.blob()
      const sampleFile = new File([blob], sampleName, { type: 'application/pdf' })
      await startUploadForFile(sampleFile)
    } catch (error) {
      setUiState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Sample upload failed.')
    }
  }

  const rerunAnalysis = async () => {
    if (!uploadedFile) {
      setUiState('error')
      setErrorMessage('No previous file found. Please upload again.')
      return
    }
    await startUploadForFile(uploadedFile)
  }

  const clearAll = () => {
    closeStatusStream()
    stopCompletionWatcher()
    const previousJobId = activeJobIdRef.current || jobId
    activeJobIdRef.current = ''
    if (previousJobId) {
      fetch(apiUrl(`/api/jobs/${previousJobId}`), { method: 'DELETE' }).catch(() => {})
    }
    fetch(apiUrl('/api/cleanup'), { method: 'POST' }).catch(() => {})
    setErrorMessage('')
    setUploadedName('')
    setUploadedFile(null)
    setJobId('')
    setUiState('idle')
    setProcessingEvents([])
    setCompletedRedactedPages([])
    setActivePanel('original')
    setDecisionView('all')
    setSearchValue('')
    setSelectedType(null)
    setVisibleCount(DECISION_PAGE_SIZE)
    setCurrentPage(1)
    setOriginalImageReady(false)
    setRedactedImageReady(false)
    setImageRefreshByPage({})
    setSelectedBoxId(null)
    setOriginalZoom(1)
    setRedactedZoom(1)
    setPageReadyNotice('')
    setTotalPages(1)
    setLivePages({})
  }

  const retryFromError = () => {
    setErrorMessage('')
    setUiState('idle')
  }

  const openDownload = () => {
    if (!jobId || uiState !== 'complete') return
    window.open(apiUrl(`/api/download/${jobId}/pdf`), '_blank', 'noopener,noreferrer')
  }

  const goToDemo = () => {
    setLandingPdfPreview(null)
    window.history.pushState({}, '', '/demo')
    setRoute('demo')
  }

  const goToLanding = () => {
    setLandingPdfPreview(null)
    window.history.pushState({}, '', '/')
    setRoute('landing')
  }

  const updateHoverFocus = (event) => {
    const container = event.currentTarget
    const rect = container.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const xPct = Math.min(100, Math.max(0, (localX / rect.width) * 100))
    const yPct = Math.min(100, Math.max(0, (localY / rect.height) * 100))
    setHoverFocus({
      active: true,
      xPct,
      yPct,
      xPx: container.scrollLeft + localX,
      yPx: container.scrollTop + localY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      viewportWidth: container.clientWidth,
      viewportHeight: container.clientHeight,
    })
  }

  const clearHoverFocus = () => {
    setHoverFocus((prev) => ({ ...prev, active: false }))
  }

  const getHoverPreviewPositionStyle = () => {
    const minLeft = hoverFocus.scrollLeft
    const maxLeft = Math.max(minLeft, hoverFocus.scrollLeft + hoverFocus.viewportWidth - HOVER_PREVIEW_SIZE)
    const minTop = hoverFocus.scrollTop
    const maxTop = Math.max(minTop, hoverFocus.scrollTop + hoverFocus.viewportHeight - HOVER_PREVIEW_SIZE)

    let left = hoverFocus.xPx + HOVER_PREVIEW_GAP
    if (left > maxLeft) {
      left = hoverFocus.xPx - HOVER_PREVIEW_SIZE - HOVER_PREVIEW_GAP
    }
    left = Math.min(maxLeft, Math.max(minLeft, left))

    let top = hoverFocus.yPx + HOVER_PREVIEW_GAP
    if (top > maxTop) {
      top = hoverFocus.yPx - HOVER_PREVIEW_SIZE - HOVER_PREVIEW_GAP
    }
    top = Math.min(maxTop, Math.max(minTop, top))

    return { left: `${left}px`, top: `${top}px` }
  }

  const scrollToLandingSection = (sectionId, stepIndex) => {
    if (sectionId === 'preprocessing-section') {
      setExpandedFlowStepIndex((prev) => (prev === stepIndex ? null : stepIndex))
      return
    }
    const sectionEl = document.getElementById(sectionId)
    if (!sectionEl) return
    sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (route !== 'demo') {
    if (landingImagePreview) {
      return (
        <main className="landing-shell">
          <section className="landing-pdf-preview-wrap">
            <div className="landing-pdf-preview-header">
              <strong>{landingImagePreview.title}</strong>
              <button type="button" className="landing-pdf-close-btn" onClick={() => setLandingImagePreview(null)} aria-label="Close image preview">
                ×
              </button>
            </div>
            <div className="landing-image-preview-wrap">
              <img className="landing-image-preview-frame" src={landingImagePreview.url} alt={landingImagePreview.title} />
            </div>
          </section>
        </main>
      )
    }

    if (landingPdfPreview) {
      return (
        <main className="landing-shell">
          <section className="landing-pdf-preview-wrap">
            <div className="landing-pdf-preview-header">
              <strong>{landingPdfPreview.title}</strong>
              <button type="button" className="landing-pdf-close-btn" onClick={() => setLandingPdfPreview(null)} aria-label="Close PDF preview">
                ×
              </button>
            </div>
            <iframe className="landing-pdf-preview-frame" src={`${landingPdfPreview.url}#zoom=100`} title={`${landingPdfPreview.title} preview`} />
          </section>
        </main>
      )
    }

    return (
      <main className="landing-shell">
        <section className="landing-hero">
          <div className="landing-logo-panel">
            <img className="logo" src={FIRSTSOURCE_LOGO_URL} alt="Firstsource logo" />
          </div>
          <div className="landing-hero-content">
            <h1>DSAR</h1>
            <h2>Data Subject Access Request</h2>
            <p>Automatically identify and redact sensitive information from PDF documents.</p>
          </div>
        </section>

        <section className="landing-section">
          <h3>Sample Documents (Input)</h3>
          <p>The solution processes various document types that may contain sensitive information requiring redaction.</p>
          <div className="doc-grid">
            {SAMPLE_DOCS.map((doc) => (
              <article key={doc.title} className="landing-card">
                <h4>{doc.title}</h4>
                <p>{doc.description}</p>
                <button type="button" className="btn btn-primary btn-sm landing-primary-btn" onClick={() => setLandingPdfPreview({ title: doc.title, url: doc.previewUrl })}>
                  View PDF
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <h3>System Processing Flow</h3>
          <p>Click any stage to jump to its detailed explanation.</p>
          <div className="system-flow-list" role="list">
            {SYSTEM_FLOW_STEPS.map((step, index) => (
              <div key={step.title} className="system-flow-step-wrap" role="listitem">
                <button type="button" className="system-flow-step" onClick={() => scrollToLandingSection(step.targetId, index)}>
                  <div className="system-flow-step-head">
                    <span className="system-flow-step-index">{step.index}</span>
                    <h4>{step.title}</h4>
                  </div>
                  <p>{step.description}</p>
                  {step.chips ? (
                    <div className="system-flow-chip-row">
                      {step.chips.map((chip) => (
                        <span key={chip} className="system-flow-chip">
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {step.rules ? (
                    <div className="system-flow-rule-list">
                      {step.rules.map((rule) => (
                        <div key={rule.label} className="system-flow-rule-item">
                          <span className={`system-flow-rule-badge ${rule.tone}`}>{rule.label}</span>
                          <span>{rule.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {step.outputs ? (
                    <div className="system-flow-output-list">
                      {step.outputs.map((item) => (
                        <div key={item.label} className="system-flow-output-item">
                          <strong>{item.label}</strong>
                          <span>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </button>
                {step.targetId === 'preprocessing-section' && expandedFlowStepIndex === index ? (
                  <div className="system-flow-inline-details">
                    <p>Before text extraction, documents undergo a multi-step image processing pipeline to improve OCR accuracy.</p>
                    <div className="preprocess-grid">
                      {PREPROCESS_PREVIEWS.map((item) => (
                        <button key={item.label} type="button" className="image-preview-card" onClick={() => setLandingImagePreview({ title: item.label, url: item.src })}>
                          <img src={item.src} alt={item.label} />
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                    <ul className="landing-list">
                      <li>PDF is converted into images and image preprocessing is applied to remove uneven lighting and enhance contrast.</li>
                      <li>PaddleOCR detects text regions and generates bounding boxes which are mapped back to the original document.</li>
                    </ul>
                  </div>
                ) : null}
                {index < SYSTEM_FLOW_STEPS.length - 1 ? <div className="system-flow-arrow">↓</div> : null}
              </div>
            ))}
          </div>
        </section>

        <div className="landing-actions">
          <button type="button" className="btn btn-primary landing-primary-btn" onClick={goToDemo}>
            View Demo
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="dashboard-shell">
      <section className="landing-hero dashboard-top-hero">
        <div className="landing-logo-panel">
          <img className="logo" src={FIRSTSOURCE_LOGO_URL} alt="Firstsource logo" />
        </div>
        <div className="landing-hero-content">
          <h1>DSAR</h1>
          <h2>Data Subject Access Request</h2>
          <p>Automatically identify and redact sensitive information from PDF documents.</p>
          <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={goToLanding}>
            Back to Overview
          </button>
        </div>
      </section>

      {uiState === 'error' ? (
        <div className="alert alert-danger alert-inline" role="alert">
          <span>{errorMessage || 'Processing failed. Please retry.'}</span>
          <button type="button" className="btn btn-danger btn-sm" onClick={retryFromError}>
            Retry
          </button>
        </div>
      ) : null}

      {compactLayout ? (
        <div className="mobile-tabs">
          {[
            { key: 'original', label: 'Original Image' },
            { key: 'redacted', label: 'Redacted Image' },
            { key: 'analysis', label: 'Decision Panel' },
          ].map((item) => (
            <button key={item.key} type="button" className={`tab-btn ${activePanel === item.key ? 'active' : ''}`} onClick={() => setActivePanel(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {uiState === 'processing' ? (
        <section className="processing-overview-wrap">
          <div className="processing-card processing-overview-card">
            <div className="status-steps">
              {PIPELINE_STEPS.map((step, index) => {
                const stateClass = index < currentStepIndex ? 'done' : index === currentStepIndex ? 'active' : 'pending'
                const marker = stateClass === 'done' ? '✓' : stateClass === 'active' ? '•••' : '•'
                return (
                  <div key={step} className="status-step-wrap">
                    <div className={`status-step ${stateClass}`}>{marker}</div>
                    <div className={`status-label ${stateClass}`}>{step}</div>
                    {index < PIPELINE_STEPS.length - 1 ? <div className={`status-connector ${index < currentStepIndex ? 'done' : ''}`} /> : null}
                  </div>
                )
              })}
            </div>
            <div className="process-name-wrap">
              <div className="process-name-title">{currentProcessAgent || 'Waiting for first process update...'}</div>
              {visibleProcessAgents.length > 0 ? (
                <div className="process-name-strip">
                  {visibleProcessAgents.map((name) => (
                    <span key={name} className={`process-chip ${name === currentProcessAgent ? 'active' : ''}`}>
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel-grid">
        <article className={`panel-card panel-original ${compactLayout && activePanel !== 'original' ? 'hidden-mobile' : ''}`}>
          <header className="panel-header panel-header-actions">
            <span>Original Document</span>
            <div className="upload-dropdown-wrap">
              <details className={`upload-dropdown ${uiState === 'processing' ? 'is-disabled' : ''}`}>
                <summary className="btn btn-primary btn-sm mb-0 upload-dropdown-trigger">
                  Upload Document
                  <span className="upload-dropdown-caret">▾</span>
                </summary>
                <div className="upload-dropdown-menu">
                  <button type="button" className="upload-dropdown-item" onClick={handleUploadFromDevice} disabled={uiState === 'processing'}>
                    Choose from device
                  </button>
                  {SAMPLE_UPLOAD_OPTIONS.map((sample) => (
                    <button
                      key={sample.name}
                      type="button"
                      className="upload-dropdown-item"
                      onClick={(event) => handleUploadSample(event, sample.name, sample.url)}
                      disabled={uiState === 'processing'}
                    >
                      {sample.name}
                    </button>
                  ))}
                </div>
              </details>
              <input ref={uploadInputRef} className="d-none" type="file" accept=".pdf,image/*" onChange={handleUpload} disabled={uiState === 'processing'} />
            </div>
          </header>
          <div className="panel-scroll">
            {jobId ? (
              <>
                <div className="pdf-toolbar">
                  <div className="small text-muted">Page {currentPage}</div>
                  <div className="zoom-controls">
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setOriginalZoom((prev) => Math.min(2.5, prev + 0.1))}>
                      Zoom In
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setOriginalZoom((prev) => Math.max(0.5, prev - 0.1))}>
                      Zoom Out
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setOriginalZoom(1)}>
                      Reset Zoom
                    </button>
                  </div>
                </div>
                {originalImageReady ? (
                  <div className="image-stage" onMouseEnter={updateHoverFocus} onMouseMove={updateHoverFocus} onMouseLeave={clearHoverFocus}>
                    <img className="result-image zoomable" style={{ transform: `scale(${originalZoom})` }} src={originalImageUrl} alt={`Original page ${currentPage}`} onError={() => setOriginalImageReady(false)} />
                    {hoverFocus.active ? (
                      <div
                        className="hover-lens-marker"
                        style={{
                          left: `${hoverFocus.xPct}%`,
                          top: `${hoverFocus.yPct}%`,
                        }}
                      />
                    ) : null}
                    {hoverFocus.active ? (
                      <div
                        className="hover-zoom-preview"
                        style={{
                          backgroundImage: `url("${originalImageUrl}")`,
                          backgroundPosition: `${hoverFocus.xPct}% ${hoverFocus.yPct}%`,
                          backgroundSize: `${HOVER_ZOOM_FACTOR * 100}%`,
                          ...getHoverPreviewPositionStyle(),
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="empty-state">Original page preview will appear when available.</div>
                )}
                <img className="d-none" src={originalImageUrl} alt="" onLoad={() => setOriginalImageReady(true)} onError={() => setOriginalImageReady(false)} />
              </>
            ) : (
              <div className="empty-state">Upload a document to start redaction analysis.</div>
            )}
          </div>
        </article>

        <article className={`panel-card panel-analysis panel-decision ${compactLayout && activePanel !== 'analysis' ? 'hidden-mobile' : ''}`}>
          <header className="panel-header panel-header-actions">
            <span>Decision Panel</span>
            {uiState === 'processing' ? (
              <div className="analysis-header-progress">
                <div className="analysis-header-track">
                  <div className="analysis-header-fill" style={{ width: `${processingPagePercent}%` }} />
                </div>
                <span className="analysis-header-text">{processingPageValue}/{Math.max(1, totalPages)}</span>
              </div>
            ) : null}
          </header>
          <div className="panel-scroll">
            {!analysisReady ? (
              uiState === 'processing' && jobId ? (
                <section className="processing-inline">
                  <div className="processing-centered-title">Processing page {currentPage}...</div>
                  <div className="processing-centered-spinner" />
                </section>
              ) : (
                <div className="empty-state">
                  {jobId ? `Page ${currentPage} analysis is not ready yet.` : 'Redaction analysis is empty until a document is uploaded and processing is completed.'}
                </div>
              )
            ) : (
              <>
                <section className="info-card">
                  <div className="classification-row">
                    <strong>Document Classified: {String(pageClassification?.document_type ?? 'unknown').replaceAll('_', ' ').toUpperCase()}</strong>
                    <span className={`confidence-pill ${confidenceTone}`}>Confidence level :{classificationConfidence}%</span>
                  </div>
                  <div className="small-label mb-1">Keywords</div>
                  <div className="trigger-tags">
                    {(pageClassification?.key_cues ?? []).slice(0, 5).map((cue) => (
                      <span key={cue} className="trigger-tag">{cue}</span>
                    ))}
                  </div>
                </section>

                <section className="stat-grid">
                  <button
                    type="button"
                    className={`stat-card stat-card-blue ${decisionView === 'all' ? 'stat-card-active' : ''}`}
                    aria-pressed={decisionView === 'all'}
                    onClick={() => setDecisionView('all')}
                  >
                    <span>Total Fields</span>
                    <strong className="stat-blue">{totalFields}</strong>
                  </button>
                  <button
                    type="button"
                    className={`stat-card stat-card-red ${decisionView === 'redacted' ? 'stat-card-active' : ''}`}
                    aria-pressed={decisionView === 'redacted'}
                    onClick={() => setDecisionView('redacted')}
                  >
                    <span>Redacted</span>
                    <strong className="stat-red">{redactedCount}</strong>
                  </button>
                  <button
                    type="button"
                    className={`stat-card stat-card-green ${decisionView === 'kept' ? 'stat-card-active' : ''}`}
                    aria-pressed={decisionView === 'kept'}
                    onClick={() => setDecisionView('kept')}
                  >
                    <span>Kept</span>
                    <strong className="stat-green">{keptCount}</strong>
                  </button>
                </section>

                <section className="decision-section">
                  <div className="decision-toolbar">
                    <strong>Redaction Summary</strong>
                    <div className="toolbar-inputs">
                      <select value={selectedType ?? ''} onChange={(event) => setSelectedType(event.target.value || null)}>
                        <option value="">Select PII type</option>
                        {piiTypeSummary.map((item) => (
                          <option key={item.type} value={item.type}>
                            {item.type} ({item.count})
                          </option>
                        ))}
                      </select>
                      <input type="search" placeholder="Search text or reason" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
                    </div>
                  </div>

                  {filteredDecisions.length === 0 ? <div className="empty-state">No decisions match the selected filters.</div> : null}
                  {filteredDecisions.length > 0 && selectedType === null ? (
                    <div className="empty-state">Select a PII type from dropdown to view decision cards.</div>
                  ) : null}

                  <div className={`decision-cards-collapse ${selectedType ? 'open' : ''}`}>
                    {selectedType ? <div className="decision-selected-title">{selectedType} ({selectedTypeDecisions.length})</div> : null}

                    {visibleSelectedTypeDecisions.map((item) => (
                      <div key={item.id} className={`decision-card ${selectedBoxId === item.boxId ? 'decision-card-active' : ''}`} onClick={() => setSelectedBoxId(item.boxId)}>
                        <div className="decision-head">
                          <div className="badge-wrap">
                            <span className={`decision-badge ${item.redact ? 'badge-red' : 'badge-green'}`}>{item.decision}</span>
                            {item.piiType ? <span className="category-badge">{item.piiType}</span> : null}
                            <span className={`confidence-chip ${getConfidenceTone(Math.round(item.confidence * 100))}`}>{Math.round(item.confidence * 100)}%</span>
                          </div>
                        </div>
                        <div className="decision-box-id">Box ID: {item.boxId}</div>
                        <div className="quoted-text">"{item.text}"</div>
                        <p className="reason-text-full">
                          <span className="reason-label">Reasoning:</span> <span className="reason-value">{item.reason}</span>
                        </p>
                      </div>
                    ))}

                    {selectedTypeDecisions.length > visibleCount ? (
                      <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={() => setVisibleCount((prev) => prev + DECISION_PAGE_SIZE)}>
                        Load more decisions
                      </button>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </div>
        </article>

        <article className={`panel-card panel-redacted ${compactLayout && activePanel !== 'redacted' ? 'hidden-mobile' : ''}`}>
          <header className="panel-header panel-header-actions">
            <span>Redacted Image</span>
          </header>
          <div className="panel-scroll">
            {jobId ? (
              <>
                <div className="pdf-toolbar">
                  <div className="small text-muted">Page {currentPage}</div>
                  <div className="zoom-controls">
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setRedactedZoom((prev) => Math.min(2.5, prev + 0.1))}>
                      Zoom In
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setRedactedZoom((prev) => Math.max(0.5, prev - 0.1))}>
                      Zoom Out
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setRedactedZoom(1)}>
                      Reset Zoom
                    </button>
                  </div>
                </div>
                {hasCurrentPageRedacted && redactedImageReady ? (
                  <div className="image-stage" onMouseEnter={updateHoverFocus} onMouseMove={updateHoverFocus} onMouseLeave={clearHoverFocus}>
                    <img className="result-image zoomable" style={{ transform: `scale(${redactedZoom})` }} src={redactedImageUrl} alt={`Redacted page ${currentPage}`} onError={() => setRedactedImageReady(false)} />
                    {hoverFocus.active ? (
                      <div
                        className="hover-lens-marker"
                        style={{
                          left: `${hoverFocus.xPct}%`,
                          top: `${hoverFocus.yPct}%`,
                        }}
                      />
                    ) : null}
                    {hoverFocus.active ? (
                      <div
                        className="hover-zoom-preview"
                        style={{
                          backgroundImage: `url("${redactedImageUrl}")`,
                          backgroundPosition: `${hoverFocus.xPct}% ${hoverFocus.yPct}%`,
                          backgroundSize: `${HOVER_ZOOM_FACTOR * 100}%`,
                          ...getHoverPreviewPositionStyle(),
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="empty-state">
                    {hasCurrentPageRedacted ? 'Loading redacted page preview...' : `Page ${currentPage} redaction not ready yet.`}
                  </div>
                )}
                {hasCurrentPageRedacted ? (
                  <img className="d-none" src={redactedImageUrl} alt="" onLoad={() => setRedactedImageReady(true)} onError={() => setRedactedImageReady(false)} />
                ) : null}
              </>
            ) : (
              <div className="empty-state">No redacted output yet.</div>
            )}
          </div>
        </article>
      </section>

      <div className="action-row bottom-actions">
        {jobId ? (
          <div className="action-row-center-pager">
            <div className="page-number-list">
              {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((page) => (
                <button
                  key={`pager-page-${page}`}
                  type="button"
                  className={`page-number-chip ${page === currentPage ? 'active' : ''}`}
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              ))}
            </div>
            {pageReadyNotice ? <div className="page-ready-notice">{pageReadyNotice}</div> : null}
          </div>
        ) : null}
        <button type="button" className="btn btn-outline-primary btn-sm" onClick={rerunAnalysis} disabled={!uploadedFile || uiState === 'processing'}>
          Re-run Analysis
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={openDownload} disabled={!jobId || uiState !== 'complete'}>
          Download PDF
        </button>
        <button type="button" className="btn btn-outline-danger btn-sm" onClick={clearAll}>
          Clear
        </button>
      </div>
    </main>
  )
}

export default App
