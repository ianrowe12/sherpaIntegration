import * as React from 'react';
import {View, Image, Linking, ScrollView, TouchableOpacity} from 'react-native';
import {Text, IconButton} from 'react-native-paper';

import {useTheme} from '../hooks';
import type {OffAnswer} from './router';

type Props = {
  answer: OffAnswer;
};

const MetricCell = ({
  label,
  value,
  color,
}: {
  label: string;
  value?: string | number;
  color: string;
}) => (
  <View style={{flex: 1, minWidth: 90, paddingVertical: 8, paddingHorizontal: 10}}>
    <Text style={{fontSize: 11, color: color, opacity: 0.7}}>{label}</Text>
    <Text style={{fontSize: 14, color: color, fontWeight: '600', marginTop: 2}}>
      {value != null && value !== '' ? String(value) : '—'}
    </Text>
  </View>
);

const Badge = ({text, bg, fg}: {text: string; bg: string; fg: string}) => (
  <View
    style={{
      backgroundColor: bg,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      marginRight: 8,
    }}>
    <Text style={{color: fg, fontSize: 12, fontWeight: '700'}}>{text}</Text>
  </View>
);

const Allergens = ({items, borderColor, textColor}: {items?: string[]; borderColor: string; textColor: string}) => {
  if (!items || items.length === 0) return null;
  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
      {items.map((a, idx) => (
        <View
          key={`${a}-${idx}`}
          style={{
            borderWidth: 1,
            borderColor,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}>
          <Text style={{fontSize: 12, color: textColor}}>{a.replace('en:', '')}</Text>
        </View>
      ))}
    </View>
  );
};

const ProductCard = ({product, theme}: {product: OffAnswer['products'][number]; theme: any}) => {
  const color = theme.colors.onSurface;
  const border = theme.colors.outlineVariant;
  const surface = theme.colors.surfaceContainer;
  const secondary = theme.colors.onSurfaceVariant;

  // Nutri-Score and NOVA color hints (basic)
  const score = (product.nutriScore || '').toUpperCase();
  const scoreBg = score
    ? ({
        A: '#2ECC71',
        B: '#7DCEA0',
        C: '#F1C40F',
        D: '#E67E22',
        E: '#E74C3C',
      } as Record<string, string>)[score] || border
    : border;
  const novaBg = product.novaGroup ? '#3B82F6' : border;

  const metricColor = color;
  const kcal = product.nutriments?.energyKcal_100g;
  const kcalText = kcal != null ? `${kcal} kcal` : undefined;

  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: surface,
        borderWidth: 1,
        borderColor: theme.colors.outlineVariant,
        overflow: 'hidden',
      }}>
      <View style={{flexDirection: 'row', padding: 12, gap: 12}}>
        {product.image ? (
          <Image
            source={{uri: product.image}}
            style={{width: 72, height: 72, borderRadius: 8, backgroundColor: theme.colors.surfaceVariant}}
          />
        ) : null}
        <View style={{flex: 1}}>
          <Text style={{color, fontSize: 16, fontWeight: '700'}} numberOfLines={2}>
            {product.name}
            {product.brand ? ` — ${product.brand}` : ''}
          </Text>
          {product.quantity ? (
            <Text style={{color: secondary, marginTop: 2}}>{product.quantity}</Text>
          ) : null}
          <View style={{flexDirection: 'row', marginTop: 8}}>
            <Badge text={`Nutri-Score ${score || '—'}`} bg={scoreBg} fg={theme.colors.onPrimary} />
            <Badge text={`NOVA ${product.novaGroup ?? '—'}`} bg={novaBg} fg={theme.colors.onPrimary} />
          </View>
        </View>
      </View>

      <View style={{height: 1, backgroundColor: border, opacity: 0.6}} />

      <View style={{paddingHorizontal: 6, paddingVertical: 8}}>
        <View style={{flexDirection: 'row'}}>
          <MetricCell label="Energy (100g)" value={kcalText} color={metricColor} />
          <MetricCell label="Protein (100g)" value={product.nutriments?.protein_100g} color={metricColor} />
          <MetricCell label="Carbs (100g)" value={product.nutriments?.carbs_100g} color={metricColor} />
        </View>
        <View style={{flexDirection: 'row'}}>
          <MetricCell label="Sugars (100g)" value={product.nutriments?.sugars_100g} color={metricColor} />
          <MetricCell label="Fat (100g)" value={product.nutriments?.fat_100g} color={metricColor} />
          <MetricCell label="Salt (100g)" value={product.nutriments?.salt_100g} color={metricColor} />
        </View>
      </View>

      {product.allergens && product.allergens.length > 0 ? (
        <View style={{paddingHorizontal: 12, paddingBottom: 12}}>
          <Text style={{color: secondary, marginBottom: 6}}>Allergens</Text>
          <Allergens items={product.allergens} borderColor={border} textColor={color} />
        </View>
      ) : null}

      <View style={{height: 1, backgroundColor: border, opacity: 0.6}} />

      <View style={{flexDirection: 'row', alignItems: 'center', padding: 8, paddingHorizontal: 12}}>
        <Text style={{color: secondary, fontSize: 12, flex: 1}}>
          Data from Open Food Facts (ODbL)
        </Text>
        {product.offUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(product.offUrl!).catch(() => {})}>
            <Text style={{color: theme.colors.primary, fontSize: 12, fontWeight: '600'}}>View</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export const OffMessage: React.FC<Props> = ({answer}) => {
  const theme = useTheme();
  const color = theme.colors.onSurface;
  const secondary = theme.colors.onSurfaceVariant;

  const [expanded, setExpanded] = React.useState(false);
  const isList = answer.type === 'list';
  const products = answer.products || [];

  if (!isList) {
    const p = products[0];
    return (
      <View style={{padding: 8}}>
        {p ? <ProductCard product={p} theme={theme} /> : (
          <View style={{padding: 12}}>
            <Text style={{color: color}}>No product found.</Text>
          </View>
        )}
      </View>
    );
  }

  const top = expanded ? products : products.slice(0, 3);
  return (
    <View style={{padding: 8}}>
      <View style={{gap: 8}}>
        {top.map(p => (
          <ProductCard key={p.code} product={p} theme={theme} />
        ))}
      </View>
      {products.length > 3 && !expanded ? (
        <View style={{alignItems: 'center', marginTop: 8}}>
          <TouchableOpacity
            onPress={() => setExpanded(true)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: theme.colors.secondaryContainer,
            }}>
            <Text style={{color: theme.colors.onSecondaryContainer, fontWeight: '600'}}>
              Show all results ({products.length})
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={{flexDirection: 'row', alignItems: 'center', paddingTop: 8}}>
        <Text style={{color: secondary, fontSize: 12}}>
          Data from Open Food Facts (ODbL)
        </Text>
      </View>
    </View>
  );
};

export default OffMessage;


