/* eslint-disable max-len -- This raw embedded browser script is intentionally compact. */
import { createHash } from 'node:crypto';

export const PROMOTION_VISUAL_SCRIPT = String.raw`(() => {
    'use strict';
    const page=document.querySelector('[data-promo-motion]');
    if(!page)return;
    const root=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const header=document.querySelector('[data-promo-header]'),hero=document.querySelector('[data-promo-hero]'),finalArea=document.querySelector('[data-promo-final]'),footer=document.querySelector('[data-promo-footer]'),mobileEntry=document.querySelector('[data-promo-mobile-entry]');
    const carousel=document.querySelector('[data-promo-carousel]'),carouselNav=document.querySelector('.promo-carousel-nav'),carouselStatus=document.querySelector('[data-promo-carousel-status]'),slides=Array.from(document.querySelectorAll('[data-promo-slide]')),slideButtons=Array.from(document.querySelectorAll('[data-promo-slide-button]'));
    const slideInterval=3000,manualHold=10000;
    let heroVisible=true,endVisible=false,scene=0,carouselTimer=0,touchStartX=0,manualHoldUntil=0,interactionPaused=false;
    root.classList.add('promo-motion-ready');

    const revealNodes=Array.from(document.querySelectorAll('[data-promo-reveal]'));
    const showAll=()=>revealNodes.forEach(node=>node.classList.add('is-visible'));
    if(reduced||typeof IntersectionObserver!=='function')showAll();
    else {
        const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');reveal.unobserve(entry.target);}}),{threshold:.12,rootMargin:'0px 0px -5% 0px'});
        revealNodes.forEach(node=>reveal.observe(node));
    }
    requestAnimationFrame(()=>requestAnimationFrame(()=>{root.classList.add('is-page-ready');page.setAttribute('data-promo-motion-state','ready');}));

    const updateEntry=()=>mobileEntry&&mobileEntry.classList.toggle('is-visible',!heroVisible&&!endVisible);
    const updateSlides=()=>{
        if(carousel)carousel.setAttribute('data-active-scene',String(scene+1));
        slides.forEach((slide,index)=>{const active=index===scene;slide.classList.toggle('is-active',active);slide.setAttribute('aria-hidden',active?'false':'true');});
        slideButtons.forEach((button,index)=>{const active=index===scene;button.classList.toggle('is-active',active);if(active)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');});
    };
    const stopCarousel=()=>{if(carouselTimer)clearTimeout(carouselTimer);carouselTimer=0;};
    const scheduleCarousel=()=>{
        stopCarousel();
        if(reduced||interactionPaused||!heroVisible||document.hidden||slides.length<2)return;
        const holdRemaining=Math.max(0,manualHoldUntil-Date.now());
        carouselTimer=setTimeout(()=>setScene(scene+1,false),holdRemaining||slideInterval);
    };
    function setScene(next,manual){
        if(!slides.length)return;
        const normalized=(next+slides.length)%slides.length;
        scene=normalized;updateSlides();
        if(manual){manualHoldUntil=Date.now()+manualHold;if(carouselStatus)carouselStatus.textContent=slides[scene].getAttribute('aria-label')||'';}
        if(carousel)carousel.setAttribute('data-last-change',manual?'manual':'automatic');
        scheduleCarousel();
    }

    updateSlides();
    slideButtons.forEach((button,index)=>button.addEventListener('click',()=>setScene(index,true)));
    const handleCarouselKeys=event=>{if(event.key==='ArrowLeft'){event.preventDefault();setScene(scene-1,true);}else if(event.key==='ArrowRight'){event.preventDefault();setScene(scene+1,true);}else if(event.key==='Home'){event.preventDefault();setScene(0,true);}else if(event.key==='End'){event.preventDefault();setScene(slides.length-1,true);}};
    if(carousel){
        carousel.addEventListener('mouseenter',()=>{interactionPaused=true;stopCarousel();});carousel.addEventListener('mouseleave',()=>{interactionPaused=false;scheduleCarousel();});
        carousel.addEventListener('focusin',()=>{interactionPaused=true;stopCarousel();});carousel.addEventListener('focusout',event=>{if(!carousel.contains(event.relatedTarget)){interactionPaused=false;scheduleCarousel();}});
        carousel.addEventListener('touchstart',event=>{interactionPaused=true;stopCarousel();touchStartX=event.changedTouches[0].clientX;},{passive:true});carousel.addEventListener('touchend',event=>{const distance=event.changedTouches[0].clientX-touchStartX;interactionPaused=false;if(Math.abs(distance)>48)setScene(scene+(distance<0?1:-1),true);else{manualHoldUntil=Date.now()+manualHold;scheduleCarousel();}},{passive:true});
        carousel.addEventListener('touchcancel',()=>{interactionPaused=false;scheduleCarousel();},{passive:true});
    }
    if(carouselNav)carouselNav.addEventListener('keydown',handleCarouselKeys);
    if(typeof IntersectionObserver==='function'){
        if(hero)new IntersectionObserver(entries=>{const entry=entries[0];heroVisible=entry.isIntersecting&&entry.intersectionRatio>.1;if(header)header.classList.toggle('is-scrolled',entry.boundingClientRect.top<24||!entry.isIntersecting);updateEntry();scheduleCarousel();},{threshold:[0,.1,.4,1],rootMargin:'-24px 0px 0px 0px'}).observe(hero);
        const endObserver=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.target===finalArea||entry.target===footer)entry.target.toggleAttribute('data-promo-end-visible',entry.isIntersecting&&entry.intersectionRatio>.04);});endVisible=Boolean(document.querySelector('[data-promo-end-visible]'));updateEntry();},{threshold:[0,.04,.18]});
        if(finalArea)endObserver.observe(finalArea);if(footer)endObserver.observe(footer);
        const itemObserver=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.classList.toggle('is-scene-active',entry.isIntersecting&&entry.intersectionRatio>.5)),{threshold:[.2,.5,.75],rootMargin:'-18% 0px -22% 0px'});
        document.querySelectorAll('[data-promo-scene-item]').forEach(node=>itemObserver.observe(node));
        const links=Array.from(document.querySelectorAll('.promo-nav a[href^="#"]'));
        const navObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)links.forEach(link=>link.classList.toggle('is-active',link.getAttribute('href')==='#'+entry.target.id));}),{threshold:.16,rootMargin:'-24% 0px -58% 0px'});
        links.forEach(link=>{const target=document.querySelector(link.getAttribute('href'));if(target)navObserver.observe(target);});
    } else {
        if(header)header.classList.add('is-scrolled');
        scheduleCarousel();
    }
    document.addEventListener('visibilitychange',scheduleCarousel);
    const faqItems=Array.from(document.querySelectorAll('.promo-faq-item')),faqAnimations=new WeakMap(),faqAnswerAnimations=new WeakMap();
    const finishFaq=(item,animation,opening)=>{
        if(faqAnimations.get(item)!==animation)return;
        if(!opening)item.open=false;
        item.classList.remove('is-faq-opening','is-faq-closing');item.style.removeProperty('height');item.style.removeProperty('overflow');
        const answerAnimation=faqAnswerAnimations.get(item);if(answerAnimation){answerAnimation.cancel();faqAnswerAnimations.delete(item);}
        faqAnimations.delete(item);
    };
    const animateFaq=(item,opening)=>{
        const summary=item.querySelector('summary'),answer=item.querySelector('.promo-faq-answer');if(!summary)return;
        const previous=faqAnimations.get(item),startHeight=item.getBoundingClientRect().height;
        if(previous){previous.onfinish=null;previous.cancel();faqAnimations.delete(item);}
        if(opening&&!item.open)item.open=true;
        item.style.removeProperty('height');
        const border=parseFloat(getComputedStyle(item).borderBottomWidth)||0,endHeight=opening?item.getBoundingClientRect().height:summary.getBoundingClientRect().height+border;
        item.style.height=startHeight+'px';item.style.overflow='hidden';item.classList.toggle('is-faq-opening',opening);item.classList.toggle('is-faq-closing',!opening);
        const previousAnswer=faqAnswerAnimations.get(item);if(previousAnswer){previousAnswer.cancel();faqAnswerAnimations.delete(item);}
        if(answer){const answerAnimation=answer.animate(opening?[{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'translateY(0)'}]:[{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],{duration:opening?260:170,delay:opening?55:0,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});faqAnswerAnimations.set(item,answerAnimation);}
        const animation=item.animate([{height:startHeight+'px'},{height:endHeight+'px'}],{duration:340,easing:'cubic-bezier(.22,1,.36,1)'});faqAnimations.set(item,animation);animation.onfinish=()=>finishFaq(item,animation,opening);
    };
    if(reduced||typeof Element.prototype.animate!=='function')faqItems.forEach(item=>item.addEventListener('toggle',()=>{if(item.open)faqItems.forEach(other=>{if(other!==item)other.open=false;});}));
    else faqItems.forEach(item=>{const summary=item.querySelector('summary');if(summary)summary.addEventListener('click',event=>{event.preventDefault();const opening=!item.open||item.classList.contains('is-faq-closing');if(opening)faqItems.forEach(other=>{if(other!==item&&other.open)animateFaq(other,false);});animateFaq(item,opening);});});
    scheduleCarousel();
})();`;

export const PROMOTION_VISUAL_SCRIPT_SHA256 = createHash('sha256')
    .update(PROMOTION_VISUAL_SCRIPT)
    .digest('base64');
