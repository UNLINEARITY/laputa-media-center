'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CHINESE_SCRIPT_STORAGE_KEY,
  type ChineseScriptMode,
  convertChineseScript,
  DEFAULT_CHINESE_SCRIPT_MODE,
  isChineseScriptMode,
} from '@/lib/i18n/chinese-script'

type ChineseScriptContextValue = {
  mode: ChineseScriptMode
  setMode: (mode: ChineseScriptMode) => void
  toggleMode: () => void
}

type TextOriginal = {
  source: string
  converted: string
}

type AttributeName = 'aria-label' | 'alt' | 'placeholder' | 'title'

type AttributeOriginal = Partial<
  Record<
    AttributeName,
    {
      source: string
      converted: string
    }
  >
>

const ChineseScriptContext = createContext<ChineseScriptContextValue | null>(null)

const TEXT_NODE = 3
const SHOW_TEXT = 4
const FILTER_ACCEPT = 1
const FILTER_REJECT = 2
const CONVERTIBLE_ATTRIBUTES: AttributeName[] = ['placeholder', 'title', 'aria-label', 'alt']
const SKIPPED_TAGS = new Set(['CODE', 'KBD', 'PRE', 'SAMP', 'SCRIPT', 'STYLE', 'TEXTAREA'])

export function ChineseScriptProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ChineseScriptMode>(DEFAULT_CHINESE_SCRIPT_MODE)
  const textOriginalsRef = useRef(new WeakMap<Text, TextOriginal>())
  const attributeOriginalsRef = useRef(new WeakMap<Element, AttributeOriginal>())
  const titleOriginalRef = useRef<string | null>(null)

  const convertTextNode = useCallback(
    (node: Text) => {
      const current = node.nodeValue ?? ''
      const previous = textOriginalsRef.current.get(node)
      const source =
        previous && (current === previous.converted || current === previous.source)
          ? previous.source
          : current
      const converted = convertChineseScript(source, mode)

      if (current !== converted) {
        node.nodeValue = converted
      }

      textOriginalsRef.current.set(node, { source, converted })
    },
    [mode],
  )

  const convertElementAttributes = useCallback(
    (element: Element) => {
      let originals = attributeOriginalsRef.current.get(element)

      for (const attributeName of CONVERTIBLE_ATTRIBUTES) {
        const current = element.getAttribute(attributeName)

        if (current === null) {
          continue
        }

        if (!originals) {
          originals = {}
          attributeOriginalsRef.current.set(element, originals)
        }

        const previous = originals[attributeName]
        const source =
          previous && (current === previous.converted || current === previous.source)
            ? previous.source
            : current
        const converted = convertChineseScript(source, mode)

        if (current !== converted) {
          element.setAttribute(attributeName, converted)
        }

        originals[attributeName] = { source, converted }
      }
    },
    [mode],
  )

  const shouldSkipElement = useCallback((element: Element | null) => {
    let current: Element | null = element

    while (current) {
      if (current.hasAttribute('data-chinese-script-skip') || SKIPPED_TAGS.has(current.tagName)) {
        return true
      }

      current = current.parentElement
    }

    return false
  }, [])

  const applyModeToRoot = useCallback(
    (root: ParentNode) => {
      if (root instanceof Element && shouldSkipElement(root)) {
        return
      }

      if (root instanceof Element) {
        convertElementAttributes(root)
      }

      const walker = document.createTreeWalker(root, SHOW_TEXT, {
        acceptNode: (node) =>
          shouldSkipElement(node.parentElement) ? FILTER_REJECT : FILTER_ACCEPT,
      })

      let currentNode = walker.nextNode()
      while (currentNode) {
        if (currentNode.nodeType === TEXT_NODE) {
          convertTextNode(currentNode as Text)
        }
        currentNode = walker.nextNode()
      }

      if ('querySelectorAll' in root) {
        for (const element of Array.from(root.querySelectorAll('*'))) {
          if (!shouldSkipElement(element)) {
            convertElementAttributes(element)
          }
        }
      }
    },
    [convertElementAttributes, convertTextNode, shouldSkipElement],
  )

  const setMode = useCallback((nextMode: ChineseScriptMode) => {
    setModeState(nextMode)
    window.localStorage.setItem(CHINESE_SCRIPT_STORAGE_KEY, nextMode)
  }, [])

  const toggleMode = useCallback(() => {
    setModeState((currentMode) => {
      const nextMode: ChineseScriptMode =
        currentMode === 'simplified' ? 'traditional' : 'simplified'
      window.localStorage.setItem(CHINESE_SCRIPT_STORAGE_KEY, nextMode)
      return nextMode
    })
  }, [])

  useEffect(() => {
    const storedMode = window.localStorage.getItem(CHINESE_SCRIPT_STORAGE_KEY)
    if (isChineseScriptMode(storedMode)) {
      setModeState(storedMode)
    }
  }, [])

  useEffect(() => {
    const lang = mode === 'simplified' ? 'zh-CN' : 'zh-TW'
    document.documentElement.lang = lang
    document.documentElement.dataset.chineseScript = mode

    if (titleOriginalRef.current === null) {
      titleOriginalRef.current = document.title
    }
    document.title = convertChineseScript(titleOriginalRef.current, mode)

    applyModeToRoot(document.body)

    if (typeof MutationObserver === 'undefined') {
      return undefined
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.nodeType === TEXT_NODE) {
          convertTextNode(mutation.target as Text)
          continue
        }

        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          if (!shouldSkipElement(mutation.target)) {
            convertElementAttributes(mutation.target)
          }
          continue
        }

        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === TEXT_NODE) {
            convertTextNode(node as Text)
          } else if (node instanceof Element) {
            applyModeToRoot(node)
          }
        }
      }
    })

    observer.observe(document.body, {
      attributeFilter: CONVERTIBLE_ATTRIBUTES,
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })

    return () => observer.disconnect()
  }, [applyModeToRoot, convertElementAttributes, convertTextNode, mode, shouldSkipElement])

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode,
    }),
    [mode, setMode, toggleMode],
  )

  return <ChineseScriptContext.Provider value={value}>{children}</ChineseScriptContext.Provider>
}

export function useChineseScript() {
  const context = useContext(ChineseScriptContext)

  if (!context) {
    throw new Error('useChineseScript must be used within ChineseScriptProvider')
  }

  return context
}
