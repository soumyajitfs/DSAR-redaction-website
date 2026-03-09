import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'

function PdfPreview({ file, pageNumber, zoom, onDocumentMeta, title }) {
  const containerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 320, height: 500 })
  const [pageRatio, setPageRatio] = useState(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        setContainerSize({
          width: Math.max(220, Math.floor(entry.contentRect.width - 10)),
          height: Math.max(260, Math.floor(entry.contentRect.height - 10)),
        })
      })
    })

    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const pageSizing = useMemo(() => {
    const viewportWidth = containerSize.width
    const viewportHeight = containerSize.height
    const viewportRatio = viewportWidth / viewportHeight

    if (!pageRatio) {
      return { width: Math.round(viewportWidth * zoom), height: undefined }
    }

    if (viewportRatio < pageRatio) {
      return { width: Math.round(viewportWidth * zoom), height: undefined }
    }

    return { width: undefined, height: Math.round(viewportHeight * zoom) }
  }, [containerSize.height, containerSize.width, pageRatio, zoom])

  const handleLoadSuccess = async (pdfDoc) => {
    setLoadError(false)
    onDocumentMeta?.(pdfDoc.numPages)
    try {
      const firstPage = await pdfDoc.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      setPageRatio(viewport.width / viewport.height)
    } catch {
      // Keep default width-fit behavior when viewport extraction fails.
      setPageRatio(null)
    }
  }

  return (
    <div ref={containerRef} className="pdf-viewer" title={title}>
      {loadError ? (
        <div className="pdf-viewer-fallback-wrap">
          <iframe
            className="pdf-viewer-fallback"
            src={`${file}#page=${pageNumber}&view=FitH&zoom=page-width&toolbar=0&navpanes=0&statusbar=0&messages=0&scrollbar=0`}
            title={`${title} fallback`}
            scrolling="no"
          />
        </div>
      ) : (
        <Document
          file={file}
          loading={<div className="pdf-loading">Loading PDF...</div>}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={() => setLoadError(true)}
        >
          <Page
            pageNumber={pageNumber}
            width={pageSizing.width}
            height={pageSizing.height}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        </Document>
      )}
    </div>
  )
}

export default PdfPreview
