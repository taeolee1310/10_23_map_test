import type { CSSProperties, ReactNode } from 'react'

export type ElasticSliderProps = {
  value?: number
  defaultValue?: number
  startingValue?: number
  maxValue?: number
  isStepped?: boolean
  stepSize?: number
  onChange?: (value: number) => void
  onChangeEnd?: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  iconPlacement?: 'outside' | 'inside'
  valuePosition?: 'top' | 'bubble' | 'inside' | 'none'
  formatValue?: (value: number) => string
  ticks?: boolean | number[]
  thumb?: boolean
  fillFrom?: number
  thickness?: number
  activeThickness?: number
  radius?: number
  restOpacity?: number
  growOnHover?: boolean
  maxStretch?: number
  bounce?: number
  jumpToClick?: boolean
  wheel?: boolean
  trackColor?: string
  rangeColor?: string
  iconColor?: string
  contentColor?: string
  fillContentColor?: string
  thumbColor?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

export default function ElasticSlider(props: ElasticSliderProps): JSX.Element
