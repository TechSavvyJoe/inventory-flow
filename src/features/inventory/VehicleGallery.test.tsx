import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VehicleGallery } from './VehicleGallery';
import type { InventoryVehicle } from './types';

const unit = { id:'TESTDATAPHOTO001', year:2024, make:'Ford', model:'F-150', trim:'Lariat', imageUrls:['https://example.com/front.jpg','https://example.com/interior.jpg','https://example.com/rear.jpg'] } as InventoryVehicle;
afterEach(cleanup);

describe('Vehicle photo gallery', () => {
  it('opens the selected photo, supports buttons, arrows and a thumbnail, then restores focus', () => {
    render(<VehicleGallery vehicle={unit} />);
    const trigger = screen.getByRole('button', {name:/Open photo gallery/});
    trigger.focus(); fireEvent.click(trigger);
    const viewer=screen.getByRole('dialog', {name:/photo gallery/});
    fireEvent.click(within(viewer).getByRole('button',{name:'Next photo'}));
    expect(within(viewer).getByRole('img',{name:/photo 2$/})).toHaveAttribute('src',unit.imageUrls![1]);
    fireEvent.keyDown(viewer,{key:'ArrowRight'});
    expect(within(viewer).getByRole('img',{name:/photo 3$/})).toHaveAttribute('src',unit.imageUrls![2]);
    fireEvent.click(within(viewer).getByRole('button',{name:'View photo 1'}));
    expect(within(viewer).getByRole('img',{name:/photo 1$/})).toHaveAttribute('src',unit.imageUrls![0]);
    fireEvent.keyDown(document,{key:'Escape'});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('swipes horizontally without treating a vertical scroll or pinch as a photo change', () => {
    render(<VehicleGallery vehicle={unit} />);
    fireEvent.click(screen.getByRole('button',{name:/Open photo gallery/}));
    const viewer=screen.getByRole('dialog');
    const stage=viewer.querySelector('.vehicle-photo-viewer__stage')!;
    fireEvent.touchStart(stage,{touches:[{clientX:260,clientY:120}]});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:50,clientY:125}]});
    expect(within(viewer).getByRole('img',{name:/photo 2$/})).toBeInTheDocument();
    fireEvent.touchStart(stage,{touches:[{clientX:260,clientY:120}]});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:220,clientY:320}]});
    expect(within(viewer).getByRole('img',{name:/photo 2$/})).toBeInTheDocument();
    fireEvent.touchStart(stage,{touches:[{clientX:260,clientY:120},{clientX:100,clientY:120}]});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:50,clientY:120}]});
    expect(within(viewer).getByRole('img',{name:/photo 2$/})).toBeInTheDocument();
  });

  it('swipes the embedded photo horizontally while leaving vertical page gestures alone', () => {
    render(<VehicleGallery vehicle={unit} />);
    const stage=document.querySelector('.inventory-workspace-gallery__stage')!;
    const trigger=screen.getByRole('button',{name:/Open photo gallery/});
    fireEvent.touchStart(stage,{touches:[{clientX:260,clientY:120}]});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:50,clientY:125}]});
    expect(trigger.querySelector('img')).toHaveAttribute('src',unit.imageUrls![1]);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.touchStart(stage,{touches:[{clientX:220,clientY:80}]});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:210,clientY:250}]});
    expect(trigger.querySelector('img')).toHaveAttribute('src',unit.imageUrls![1]);
  });

  it('skips failed images and closes safely if all supplied photos fail', () => {
    render(<VehicleGallery vehicle={unit} />);
    fireEvent.click(screen.getByRole('button',{name:/Open photo gallery/}));
    for(let index=0;index<3;index++) {
      fireEvent.error(within(screen.getByRole('dialog')).getByRole('img',{name:/photo \d$/}));
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Photos are not available')).toBeVisible();
    const fallback = screen.getByRole('region', {name:/Vehicle photos for .* unavailable/});
    expect(fallback).toHaveAttribute('tabindex','-1');
    expect(fallback).toHaveFocus();
  });

  it('keeps the selected photo when an earlier thumbnail fails', () => {
    render(<VehicleGallery vehicle={unit} />);
    fireEvent.click(screen.getByRole('button',{name:'Show vehicle photo 2'}));
    expect(screen.getByRole('button',{name:/Open photo gallery/}).querySelector('img')).toHaveAttribute('src',unit.imageUrls![1]);
    fireEvent.error(screen.getByRole('button',{name:'Show vehicle photo 1'}).querySelector('img')!);
    expect(screen.getByRole('button',{name:/Open photo gallery/}).querySelector('img')).toHaveAttribute('src',unit.imageUrls![1]);
    expect(screen.getByText('1 / 2')).toBeVisible();
  });

  it('pinches and pans the photo, bounds zoom, and resets for the next photo', () => {
    render(<VehicleGallery vehicle={unit} />);
    fireEvent.click(screen.getByRole('button',{name:/Open photo gallery/}));
    const viewer=screen.getByRole('dialog');
    const stage=viewer.querySelector('.vehicle-photo-viewer__stage')!;
    vi.spyOn(stage,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:300,height:300,right:300,bottom:300,x:0,y:0,toJSON:()=>({})});
    fireEvent.touchStart(stage,{touches:[{clientX:100,clientY:150},{clientX:200,clientY:150}]});
    fireEvent.touchMove(stage,{touches:[{clientX:50,clientY:150},{clientX:250,clientY:150}]});
    expect(within(viewer).getByRole('button',{name:'Reset photo zoom'})).toHaveTextContent('200%');
    fireEvent.touchEnd(stage,{touches:[{clientX:50,clientY:150}],changedTouches:[{clientX:250,clientY:150}]});
    fireEvent.touchMove(stage,{touches:[{clientX:75,clientY:170}]});
    expect(within(viewer).getByRole('img',{name:/photo 1$/})).toHaveStyle({transform:'translate(25px, 20px) scale(2)'});
    fireEvent.touchEnd(stage,{touches:[],changedTouches:[{clientX:75,clientY:170}]});
    expect(within(viewer).getByRole('img',{name:/photo 1$/})).toBeInTheDocument();
    for(let i=0;i<10;i++) fireEvent.click(within(viewer).getByRole('button',{name:'Zoom in'}));
    expect(within(viewer).getByRole('button',{name:'Reset photo zoom'})).toHaveTextContent('500%');
    expect(within(viewer).getByRole('button',{name:'Zoom in'})).toBeDisabled();
    fireEvent.click(within(viewer).getByRole('button',{name:'Next photo'}));
    expect(within(viewer).getByRole('button',{name:'Reset photo zoom'})).toHaveTextContent('100%');
  });
});
