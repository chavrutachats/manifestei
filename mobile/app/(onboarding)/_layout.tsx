import { Stack } from 'expo-router';
import { color } from '../../src/theme';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />;
}
