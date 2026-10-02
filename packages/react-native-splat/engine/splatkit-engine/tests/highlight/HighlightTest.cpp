#include "splatkit/highlight/Highlight.h"

#include <vector>

#include <gtest/gtest.h>

namespace splatkit {
namespace {

constexpr float kTolerance = 1e-6f;

void finishFade(Highlight& highlight) {
  while (highlight.update(0.05f)) {
  }
}

void expectAsCaptured(const LabelStyle& style) {
  EXPECT_EQ(style.tintAmount, 0.0f);
  EXPECT_EQ(style.brightness, 1.0f);
  EXPECT_EQ(style.opacity, 1.0f);
}

TEST(Highlight, StartsWithEverySplatAsCaptured) {
  Highlight highlight;
  EXPECT_FALSE(highlight.fading());
  EXPECT_FALSE(highlight.update(1));
  for (const LabelStyle& style : highlight.styles()) expectAsCaptured(style);
}

TEST(Highlight, EmphasisesItsPartsAndDimsEverythingElse) {
  Highlight highlight;
  const std::vector<std::uint8_t> labels = {3, 7};
  highlight.set(labels.data(), labels.size());
  finishFade(highlight);
  const LabelStyles& styles = highlight.styles();
  for (const std::uint8_t label : labels) {
    EXPECT_EQ(styles[label].tintAmount, Highlight::kTintAmount);
    EXPECT_EQ(styles[label].tint[2], Highlight::kTint[2]);
    EXPECT_EQ(styles[label].brightness, Highlight::kEmphasisBrightness);
  }
  EXPECT_EQ(styles[0].brightness, Highlight::kDimBrightness);  // unlabelled splats too
  EXPECT_EQ(styles[4].brightness, Highlight::kDimBrightness);
  EXPECT_EQ(styles[255].tintAmount, 0.0f);
  EXPECT_EQ(styles[4].opacity, 1.0f);  // dimmed, never see-through
}

TEST(Highlight, FadesOverAQuarterSecondThenRests) {
  Highlight highlight;
  const std::uint8_t label = 5;
  highlight.set(&label, 1);
  EXPECT_TRUE(highlight.fading());
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  // Halfway in time is halfway along the eased fade.
  EXPECT_NEAR(highlight.styles()[label].tintAmount, Highlight::kTintAmount / 2, kTolerance);
  EXPECT_NEAR(highlight.styles()[1].brightness, (1 + Highlight::kDimBrightness) / 2, kTolerance);
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_FALSE(highlight.fading());
  EXPECT_FALSE(highlight.update(1));
  EXPECT_EQ(highlight.styles()[label].tintAmount, Highlight::kTintAmount);
}

TEST(Highlight, AnEmptySetFadesBackToTheCapture) {
  Highlight highlight;
  const std::uint8_t label = 5;
  highlight.set(&label, 1);
  finishFade(highlight);
  highlight.set(nullptr, 0);
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  // The fading tint keeps its colour instead of blending towards black.
  EXPECT_EQ(highlight.styles()[label].tint[0], Highlight::kTint[0]);
  finishFade(highlight);
  for (const LabelStyle& style : highlight.styles()) expectAsCaptured(style);
}

TEST(Highlight, ANewSetStartsFromWhereTheFadeWas) {
  Highlight highlight;
  const std::uint8_t first = 5;
  const std::uint8_t second = 9;
  highlight.set(&first, 1);
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  const float halfway = highlight.styles()[first].tintAmount;
  highlight.set(&second, 1);
  ASSERT_TRUE(highlight.update(0));
  EXPECT_NEAR(highlight.styles()[first].tintAmount, halfway, kTolerance);  // no jump
  finishFade(highlight);
  EXPECT_EQ(highlight.styles()[first].tintAmount, 0.0f);
  EXPECT_EQ(highlight.styles()[second].tintAmount, Highlight::kTintAmount);
}

TEST(Highlight, TheSetItHeadsForAgainChangesNothing) {
  Highlight highlight;
  const std::vector<std::uint8_t> labels = {3, 7};
  const std::vector<std::uint8_t> sameParts = {7, 3, 7};
  highlight.set(labels.data(), labels.size());
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  highlight.set(sameParts.data(), sameParts.size());  // a re-render sends the parts again
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_FALSE(highlight.fading());
  highlight.set(sameParts.data(), sameParts.size());
  EXPECT_FALSE(highlight.fading());
  EXPECT_EQ(highlight.styles()[3].tintAmount, Highlight::kTintAmount);
}

TEST(Highlight, ClearingWhatIsNotHighlightedChangesNothing) {
  Highlight highlight;
  highlight.set(nullptr, 0);
  EXPECT_FALSE(highlight.fading());
}

}  // namespace
}  // namespace splatkit
