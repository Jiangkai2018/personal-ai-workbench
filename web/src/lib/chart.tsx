// ECharts 按需封装：只注册用到的 饼/柱/线 + 提示/图例/网格，Canvas 渲染。
// 主题贴合纸墨风：墨色文字、朱砂主色、纸色背景。
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([PieChart, BarChart, LineChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer])

/** 图表调色板：朱砂领衔，墨/玉/琥珀/黛蓝随行 */
export const CHART_COLORS = [
  '#c2401c',
  '#211f1b',
  '#3f7d58',
  '#9a6a10',
  '#4a5a7a',
  '#8c5a52',
  '#5c574c',
  '#b08a5a',
  '#6253a8',
  '#7a8a6a',
]

export function Chart({ option, height = 260 }: { option: EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = echarts.init(ref.current)
    const observer = new ResizeObserver(() => chartRef.current?.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, true)
  }, [option])

  return <div ref={ref} style={{ width: '100%', height }} className="chart-box" />
}
