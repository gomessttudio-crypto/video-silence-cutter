'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import type { DetectionOptions } from '@/lib/types'
import { DEFAULT_DETECTION } from '@/lib/types'

interface DetectionSettingsProps {
  value: DetectionOptions
  onChange: (options: DetectionOptions) => void
  disabled?: boolean
}

interface ControlRowProps {
  label: string
  description: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  unit?: string
  offLabel?: string
  onChange: (v: number) => void
  disabled?: boolean
}

function ControlRow({
  label, description, value, min, max, step, decimals = 2, unit, offLabel, onChange, disabled,
}: ControlRowProps) {
  const [inputVal, setInputVal] = useState(String(value))

  useEffect(() => {
    setInputVal(String(value))
  }, [value])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputVal(e.target.value)
    const parsed = parseFloat(e.target.value)
    if (!isNaN(parsed)) {
      onChange(Math.min(max, Math.max(min, parsed)))
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-gray-200">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Slider
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(v) => onChange(v as number)}
            disabled={disabled}
            styles={{
              track: { backgroundColor: '#3b82f6' },
              rail: { backgroundColor: '#374151' },
              handle: { borderColor: '#3b82f6', backgroundColor: '#3b82f6' },
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={inputVal}
            onChange={handleInputChange}
            disabled={disabled}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm
              text-gray-200 text-right focus:outline-none focus:border-blue-500
              disabled:opacity-50"
          />
          {unit && <span className="text-xs text-gray-500">{unit}</span>}
        </div>
      </div>
    </div>
  )
}

export default function DetectionSettings({ value, onChange, disabled }: DetectionSettingsProps) {
  const [paddingLocked, setPaddingLocked] = useState(true)

  // Estado local: atualização visual imediata ao arrastar
  const [localValue, setLocalValue] = useState<DetectionOptions>(value)

  // Debounce para o onChange do pai (evita re-processar a cada tick do drag)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<DetectionOptions>(value)

  // Sincroniza local quando o pai muda externamente (ex: "Restaurar padrões")
  useEffect(() => {
    setLocalValue(value)
    pendingRef.current = value
  }, [value])

  const emitChange = useCallback(
    (next: DetectionOptions) => {
      pendingRef.current = next
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onChange(pendingRef.current)
      }, 400)
    },
    [onChange]
  )

  function update(field: keyof DetectionOptions, val: number) {
    const next = { ...pendingRef.current, [field]: val }

    if (paddingLocked) {
      if (field === 'paddingLeft') next.paddingRight = val
      if (field === 'paddingRight') next.paddingLeft = val
    }

    // Atualiza visual imediatamente (sem esperar o debounce)
    setLocalValue(next)
    // Notifica o pai com debounce
    emitChange(next)
  }

  const lv = localValue

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-5">
      <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
        Configurações de Detecção
      </h3>

      {/* Threshold */}
      <ControlRow
        label="Threshold"
        description="Abaixo deste nível é considerado silêncio."
        value={lv.threshold}
        min={0.001}
        max={1}
        step={0.001}
        decimals={4}
        onChange={(val) => update('threshold', val)}
        disabled={disabled}
      />

      <div className="border-t border-gray-800" />

      {/* Min Duration */}
      <ControlRow
        label="Duração Mínima"
        description="Silêncios mais longos que isso serão cortados."
        value={lv.minDuration}
        min={0.1}
        max={10}
        step={0.1}
        decimals={1}
        unit="s"
        onChange={(val) => update('minDuration', val)}
        disabled={disabled}
      />

      <div className="border-t border-gray-800" />

      {/* Padding */}
      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-gray-200">Padding</p>
          <p className="text-xs text-gray-500">Espaço mantido antes e após cada corte.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-gray-500">Esquerda</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Slider
                  min={0}
                  max={2}
                  step={0.0167}
                  value={lv.paddingLeft}
                  onChange={(val) => update('paddingLeft', val as number)}
                  disabled={disabled}
                  styles={{
                    track: { backgroundColor: '#3b82f6' },
                    rail: { backgroundColor: '#374151' },
                    handle: { borderColor: '#3b82f6', backgroundColor: '#3b82f6' },
                  }}
                />
              </div>
              <span className="text-xs text-gray-300 w-12 text-right">{lv.paddingLeft.toFixed(4)}s</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Direita</p>
              <button
                onClick={() => setPaddingLocked(!paddingLocked)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors
                  ${paddingLocked ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                title={paddingLocked ? 'Sincronizado' : 'Independente'}
              >
                {paddingLocked ? '🔒' : '🔓'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Slider
                  min={0}
                  max={2}
                  step={0.0167}
                  value={lv.paddingRight}
                  onChange={(val) => update('paddingRight', val as number)}
                  disabled={disabled || paddingLocked}
                  styles={{
                    track: { backgroundColor: '#3b82f6' },
                    rail: { backgroundColor: '#374151' },
                    handle: { borderColor: '#3b82f6', backgroundColor: '#3b82f6' },
                  }}
                />
              </div>
              <span className="text-xs text-gray-300 w-12 text-right">{lv.paddingRight.toFixed(4)}s</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800" />

      {/* Remove Short Spikes */}
      <ControlRow
        label="Remove Short Spikes"
        description="Clips de áudio menores que isso serão ignorados. 0 = desabilitado."
        value={lv.removeShortSpikes}
        min={0}
        max={5}
        step={0.1}
        decimals={1}
        unit="s"
        offLabel="Off"
        onChange={(val) => update('removeShortSpikes', val)}
        disabled={disabled}
      />

      <button
        onClick={() => {
          const defaults = { ...DEFAULT_DETECTION }
          setLocalValue(defaults)
          emitChange(defaults)
        }}
        disabled={disabled}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
      >
        Restaurar padrões
      </button>
    </div>
  )
}
