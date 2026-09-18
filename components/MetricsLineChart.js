import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../ThemeContext';

/**
 * Generates smooth cubic bezier curve paths and area fills
 */
function buildSmoothPath(points, height, padTop = 16, padBottom = 20, fixedMax = null) {
  if (!points || points.length === 0) return { path: '', area: '', maxVal: 100, minVal: 0, pointsCount: 0 };

  const validValues = points.map(p => (typeof p === 'number' ? p : (p?.value ?? 0)));
  const calculatedMax = Math.max(...validValues, 0.1);
  const maxVal = fixedMax !== null && fixedMax > 0 ? Math.max(fixedMax, calculatedMax) : (calculatedMax <= 5 ? 5 : calculatedMax);
  const minVal = 0;

  const count = validValues.length;
  const usableH = height - padTop - padBottom;

  return (width) => {
    if (width <= 0 || count < 2) return { path: '', area: '', maxVal, minVal, pointsCount: count };

    const stepX = width / (count - 1);
    const coords = validValues.map((v, i) => {
      const normalized = Math.max(0, Math.min(v, maxVal));
      const x = Number((i * stepX).toFixed(1));
      const y = Number((height - padBottom - (normalized / maxVal) * usableH).toFixed(1));
      return { x, y };
    });

    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX = (curr.x + next.x) / 2;
      path += ` C ${cpX} ${curr.y}, ${cpX} ${next.y}, ${next.x} ${next.y}`;
    }

    const last = coords[coords.length - 1];
    const area = `${path} L ${last.x} ${height - padBottom} L ${coords[0].x} ${height - padBottom} Z`;

    return { path, area, maxVal, minVal, pointsCount: count, lastPoint: last };
  };
}

export default function MetricsLineChart({
  data = [],
  data2 = null,
  color = '#0284c7',
  color2 = '#a855f7',
  label = '实时走势',
  label2 = null,
  unit = '%',
  maxValue = null,
  height = 155,
  formatValue = null,
  showStats = true,
}) {
  const { colors, isDark } = useTheme();
  const [chartWidth, setChartWidth] = useState(320);

  // Normalize data to ensure smooth 5-minute curve (target 30~60 points)
  const normalizedData1 = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    if (list.length === 0) {
      return Array(30).fill(0);
    }
    if (list.length === 1) {
      return Array(30).fill(typeof list[0] === 'number' ? list[0] : (list[0]?.value ?? 0));
    }
    // If fewer than 15 points, pad beginning with first point
    if (list.length < 15) {
      const first = typeof list[0] === 'number' ? list[0] : (list[0]?.value ?? 0);
      const pad = Array(15 - list.length).fill(first);
      return [...pad, ...list.map(v => (typeof v === 'number' ? v : (v?.value ?? 0)))];
    }
    return list.map(v => (typeof v === 'number' ? v : (v?.value ?? 0)));
  }, [data]);

  const normalizedData2 = useMemo(() => {
    if (!data2) return null;
    const list = Array.isArray(data2) ? data2 : [];
    if (list.length === 0) return Array(30).fill(0);
    if (list.length < 15) {
      const first = typeof list[0] === 'number' ? list[0] : (list[0]?.value ?? 0);
      const pad = Array(15 - list.length).fill(first);
      return [...pad, ...list.map(v => (typeof v === 'number' ? v : (v?.value ?? 0)))];
    }
    return list.map(v => (typeof v === 'number' ? v : (v?.value ?? 0)));
  }, [data2]);

  // Combined max for dual series
  const effectiveMax = useMemo(() => {
    if (maxValue !== null) return maxValue;
    const max1 = Math.max(...normalizedData1, 0.1);
    const max2 = normalizedData2 ? Math.max(...normalizedData2, 0.1) : 0;
    const computed = Math.max(max1, max2);
    return computed <= 5 ? 5 : computed * 1.12;
  }, [maxValue, normalizedData1, normalizedData2]);

  const pathGen1 = useMemo(() => buildSmoothPath(normalizedData1, height, 16, 22, effectiveMax), [normalizedData1, height, effectiveMax]);
  const pathGen2 = useMemo(() => (normalizedData2 ? buildSmoothPath(normalizedData2, height, 16, 22, effectiveMax) : null), [normalizedData2, height, effectiveMax]);

  const result1 = useMemo(() => pathGen1(chartWidth), [pathGen1, chartWidth]);
  const result2 = useMemo(() => (pathGen2 ? pathGen2(chartWidth) : null), [pathGen2, chartWidth]);

  // Statistical calculations computed strictly from raw valid data points (no padding distortion)
  const stats1 = useMemo(() => {
    const rawList = (Array.isArray(data) ? data : [])
      .map(v => (typeof v === 'number' ? v : (typeof v?.value === 'number' ? v.value : Number(v))))
      .filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (rawList.length === 0) return { current: 0, max: 0, avg: 0 };
    const curr = rawList[rawList.length - 1] || 0;
    const max = Math.max(...rawList);
    const sum = rawList.reduce((acc, v) => acc + v, 0);
    const avg = sum / rawList.length;
    return { current: curr, max, avg };
  }, [data]);

  const stats2 = useMemo(() => {
    if (!data2) return null;
    const rawList = (Array.isArray(data2) ? data2 : [])
      .map(v => (typeof v === 'number' ? v : (typeof v?.value === 'number' ? v.value : Number(v))))
      .filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (rawList.length === 0) return { current: 0, max: 0, avg: 0 };
    const curr = rawList[rawList.length - 1] || 0;
    const max = Math.max(...rawList);
    const sum = rawList.reduce((acc, v) => acc + v, 0);
    const avg = sum / rawList.length;
    return { current: curr, max, avg };
  }, [data2]);

  const formatText = (num) => {
    if (formatValue) return formatValue(num);
    if (num >= 100) return `${Math.round(num)}${unit}`;
    if (num >= 10) return `${num.toFixed(1)}${unit}`;
    return `${num.toFixed(1)}${unit}`;
  };

  const gridLevels = [1, 0.5, 0];
  const usableH = height - 16 - 22;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.45)' : 'rgba(241, 245, 249, 0.75)' }]}>
      {/* Header Stat Row */}
      {showStats && (
        <View style={styles.statsRow}>
          <View style={styles.statLeft}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={[styles.labelTitle, { color: colors.textStrong }]}>{label}</Text>
            <Text style={[styles.currentValue, { color }]}>{formatText(stats1.current)}</Text>
          </View>

          <View style={styles.statBadges}>
            <View style={styles.badgeItem}>
              <Text style={[styles.badgeLabel, { color: colors.muted }]}>峰值</Text>
              <Text style={[styles.badgeValue, { color: colors.text }]}>{formatText(stats1.max)}</Text>
            </View>
            <View style={[styles.badgeItem, { marginLeft: 10 }]}>
              <Text style={[styles.badgeLabel, { color: colors.muted }]}>均值</Text>
              <Text style={[styles.badgeValue, { color: colors.text }]}>{formatText(stats1.avg)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Optional Second Series Header (e.g. Upload) */}
      {stats2 && label2 && (
        <View style={[styles.statsRow, { marginTop: 4 }]}>
          <View style={styles.statLeft}>
            <View style={[styles.legendDot, { backgroundColor: color2 }]} />
            <Text style={[styles.labelTitle, { color: colors.textStrong }]}>{label2}</Text>
            <Text style={[styles.currentValue, { color: color2 }]}>{formatText(stats2.current)}</Text>
          </View>
          <View style={styles.statBadges}>
            <View style={styles.badgeItem}>
              <Text style={[styles.badgeLabel, { color: colors.muted }]}>峰值</Text>
              <Text style={[styles.badgeValue, { color: colors.text }]}>{formatText(stats2.max)}</Text>
            </View>
            <View style={[styles.badgeItem, { marginLeft: 10 }]}>
              <Text style={[styles.badgeLabel, { color: colors.muted }]}>均值</Text>
              <Text style={[styles.badgeValue, { color: colors.text }]}>{formatText(stats2.avg)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* SVG Canvas with onLayout auto-width */}
      <View
        style={{ width: '100%', height }}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 50 && w !== chartWidth) {
            setChartWidth(w);
          }
        }}
      >
        <Svg width={chartWidth} height={height}>
          <Defs>
            <LinearGradient id="chartGrad1" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={color} stopOpacity={isDark ? 0.35 : 0.28} />
              <Stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </LinearGradient>
            {result2 && (
              <LinearGradient id="chartGrad2" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={color2} stopOpacity={isDark ? 0.30 : 0.22} />
                <Stop offset="100%" stopColor={color2} stopOpacity={0.0} />
              </LinearGradient>
            )}
          </Defs>

          {/* Horizontal Dashed Grid Lines & Y-Axis Coordinate Labels */}
          {gridLevels.map((lvl, idx) => {
            const y = Number((height - 22 - lvl * usableH).toFixed(1));
            const labelText = formatText(effectiveMax * lvl);
            const textY = lvl === 1 ? y + 10 : y - 3;
            return (
              <React.Fragment key={idx}>
                <Line
                  x1={0}
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke={isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)'}
                  strokeWidth={1}
                  strokeDasharray="4, 4"
                />
                <SvgText
                  x={6}
                  y={textY}
                  fontSize={9}
                  fill={isDark ? 'rgba(148, 163, 184, 0.85)' : 'rgba(71, 85, 105, 0.85)'}
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {labelText}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* Area Fills */}
          {result1.area ? <Path d={result1.area} fill="url(#chartGrad1)" /> : null}
          {result2 && result2.area ? <Path d={result2.area} fill="url(#chartGrad2)" /> : null}

          {/* Stroke Lines */}
          {result1.path ? (
            <Path
              d={result1.path}
              stroke={color}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}

          {result2 && result2.path ? (
            <Path
              d={result2.path}
              stroke={color2}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </Svg>

        {/* Time Axis Labels */}
        <View style={styles.timeAxis}>
          <Text style={[styles.timeLabel, { color: colors.muted }]}>-5分</Text>
          <Text style={[styles.timeLabel, { color: colors.muted }]}>-4分</Text>
          <Text style={[styles.timeLabel, { color: colors.muted }]}>-3分</Text>
          <Text style={[styles.timeLabel, { color: colors.muted }]}>-2分</Text>
          <Text style={[styles.timeLabel, { color: colors.muted }]}>-1分</Text>
          <Text style={[styles.timeLabel, { color: colors.accent, fontWeight: '700' }]}>实时</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
    marginVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148, 163, 184, 0.15)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  labelTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 8,
  },
  currentValue: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  statBadges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginRight: 3,
  },
  badgeValue: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  timeAxis: {
    position: 'absolute',
    bottom: 2,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  timeLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
});
