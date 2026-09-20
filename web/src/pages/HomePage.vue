<script setup lang="ts">
import { useScrollReveal } from '../composables/useScrollReveal'
import HeroSection from '../components/sections/HeroSection.vue'
import QuestSection from '../components/sections/QuestSection.vue'
import ParticipantsSection from '../components/sections/ParticipantsSection.vue'
import SimpleVisionSection from '../components/sections/SimpleVisionSection.vue'
import SimpleMissionSection from '../components/sections/SimpleMissionSection.vue'
import SimpleParticipateSection from '../components/sections/SimpleParticipateSection.vue'
import PrizeSection from '../components/sections/PrizeSection.vue'
import EvaluationSection from '../components/sections/EvaluationSection.vue'
import SubmissionSection from '../components/sections/SubmissionSection.vue'
import LeaderboardSection from '../components/sections/LeaderboardSection.vue'
import OrganizersSection from '../components/sections/OrganizersSection.vue'
import CtaSection from '../components/sections/CtaSection.vue'

useScrollReveal()
</script>

<template>
  <main>
    <HeroSection />
    <QuestSection />
    <ParticipantsSection />
    <SimpleVisionSection />
    <SimpleMissionSection />
    <SimpleParticipateSection />
    <PrizeSection />
    <EvaluationSection />
    <SubmissionSection />
    <LeaderboardSection />
    <OrganizersSection />
    <CtaSection />
  </main>
</template>
